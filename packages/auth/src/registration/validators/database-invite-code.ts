import { ConflictError } from "@opensaas/core";
import {
  consumeRegistrationCode,
  getRegistrationCode,
} from "@opensaas/database";
import type {
  InviteCodeCheck,
  InviteCodeValidator,
} from "../strategies/invite-code";
import type { RegistrationContext } from "../types";

/**
 * Store-backed invitation-code validator (§3.2). It reads the code from the
 * `registration_code` table for an early verdict, and defers the authoritative,
 * race-safe consumption to `consume`, which the registration flow runs inside
 * its transaction via the repository's `SELECT ... FOR UPDATE` path.
 *
 * The pre-check is only a fast rejection; it never mutates, so it is safe to
 * call outside a transaction.
 */
export const createDatabaseInviteCodeValidator = (): InviteCodeValidator => ({
  async check(code, _context: RegistrationContext): Promise<InviteCodeCheck> {
    const row = await getRegistrationCode({ code });

    if (!row) {
      return {
        valid: false,
        code: "INVALID_INVITE_CODE",
        message: "The invitation code is invalid or has already been used.",
      };
    }

    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return {
        valid: false,
        code: "INVITE_CODE_EXPIRED",
        message: "The invitation code has expired.",
      };
    }

    if (row.status !== "pending" || row.useCount >= row.maxUses) {
      return {
        valid: false,
        code: "INVITE_CODE_ALREADY_USED",
        message: "The invitation code is invalid or has already been used.",
      };
    }

    return {
      valid: true,
      consume: async (userId, tx) => {
        // Authoritative, atomic consume: re-validates under `FOR UPDATE` so a
        // concurrent registration cannot consume the same last use.
        const result = await consumeRegistrationCode({
          code,
          userId,
          tx,
        });
        if (!result.consumed) {
          // The pre-check passed but the code was consumed/expired by a
          // concurrent request in between: a typed 409, never a 500.
          throw new ConflictError(
            "The invitation code is invalid or has already been used.",
            { field: "inviteCode", reason: result.reason },
            "INVITE_CODE_ALREADY_USED",
          );
        }
      },
    };
  },
});
