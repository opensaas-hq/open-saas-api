import { describe, expect, test } from "bun:test";
import { ForbiddenError, ValidationError } from "@opensaas/core";
import {
  type PaymentVerificationPort,
  denyAllPayments,
} from "../ports/payment";
import { createInviteCodeStrategy } from "../registration/strategies/invite-code";
import { createPaidRequiredStrategy } from "../registration/strategies/paid-required";

describe("@opensaas/auth - Registration strategies (§3.2)", () => {
  const baseContext = { mode: "public" as const, email: "user@example.com" };

  describe("invite_code", () => {
    test("rejects an empty code before consulting the validator", async () => {
      const strategy = createInviteCodeStrategy({
        async check() {
          throw new Error("validator must not be called");
        },
      });

      await expect(
        strategy.validate({ ...baseContext, mode: "invite_code" }),
      ).rejects.toThrow(ValidationError);
    });

    test("rejects a code the validator reports invalid", async () => {
      const strategy = createInviteCodeStrategy({
        async check() {
          return {
            valid: false,
            code: "INVALID_INVITE_CODE",
            message: "nope",
          };
        },
      });

      await expect(
        strategy.validate({
          ...baseContext,
          mode: "invite_code",
          inviteCode: "any",
        }),
      ).rejects.toThrow(ValidationError);
    });

    test("accepts a valid code and schedules exactly-once consumption", async () => {
      let consumedWith: string | undefined;
      const strategy = createInviteCodeStrategy({
        async check() {
          return {
            valid: true,
            consume: async (userId) => {
              consumedWith = userId;
            },
          };
        },
      });

      const outcome = await strategy.validate({
        ...baseContext,
        mode: "invite_code",
        inviteCode: "VALID",
      });

      expect(outcome.status).toBe("active");
      expect(consumedWith).toBeUndefined();
      // The test only asserts the callback fires with the user id; the
      // transaction handle is opaque to it, so a stub is fine.
      await outcome.onCommit?.("user_1", {} as never);
      expect(consumedWith).toBe("user_1");
    });
  });

  describe("paid_required", () => {
    test("the deny-by-default port always refuses with PAYMENT_REQUIRED", async () => {
      const strategy = createPaidRequiredStrategy(denyAllPayments);
      await expect(
        strategy.validate({ ...baseContext, mode: "paid_required" }),
      ).rejects.toThrow(ForbiddenError);
    });

    test("a verified payment grants an active account", async () => {
      const payments: PaymentVerificationPort = {
        async verify() {
          return { verified: true, reference: "pi_123" };
        },
      };
      const strategy = createPaidRequiredStrategy(payments);
      const outcome = await strategy.validate({
        ...baseContext,
        mode: "paid_required",
      });
      expect(outcome.status).toBe("active");
    });
  });
});
