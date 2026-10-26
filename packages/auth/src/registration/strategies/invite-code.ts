import { ValidationError } from "@opensaas/core";
import type { Transaction } from "@opensaas/database";
import type {
  RegistrationContext,
  RegistrationOutcome,
  RegistrationStrategy,
} from "../types";

/**
 * Server-side invitation-code check. Implementations validate a code against
 * the authoritative store and, when valid, schedule its one-time consumption.
 * The registration flow runs the returned `consume` inside its transaction so
 * the whole thing is atomic (§3.2).
 */
export type InviteCodeCheck =
  | {
      valid: true;
      /**
       * Consume one use of the code. Called inside the registration
       * transaction after the user exists.
       */
      consume: (userId: string, tx: Transaction) => Promise<void>;
    }
  | { valid: false; code: string; message: string };

export interface InviteCodeValidator {
  check(code: string, context: RegistrationContext): Promise<InviteCodeCheck>;
}

/**
 * Deny-by-default invite validator: no code is valid until a store-backed
 * validator is injected (§3.2).
 */
export const rejectAllInviteCodes: InviteCodeValidator = {
  async check() {
    return {
      valid: false,
      code: "INVALID_INVITE_CODE",
      message: "The invitation code is invalid or has already been used.",
    };
  },
};

/**
 * Build the `invite_code` strategy around a validator. The strategy enforces
 * that a code was supplied, delegates the server-side check, and returns the
 * consumption as an `onCommit` side effect.
 */
export const createInviteCodeStrategy = (
  validator: InviteCodeValidator,
): RegistrationStrategy => ({
  mode: "invite_code",
  async validate(context: RegistrationContext): Promise<RegistrationOutcome> {
    const code = context.inviteCode?.trim();
    if (!code) {
      throw new ValidationError("An invitation code is required to register.", {
        field: "inviteCode",
        code: "INVITE_CODE_REQUIRED",
      });
    }

    const result = await validator.check(code, context);
    if (!result.valid) {
      throw new ValidationError(result.message, {
        field: "inviteCode",
        code: result.code,
      });
    }

    return {
      status: "active",
      onCommit: async (userId, tx) => {
        await result.consume(userId, tx);
      },
    };
  },
});
