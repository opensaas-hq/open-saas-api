import { ForbiddenError } from "@opensaas/core";
import type { PaymentVerificationPort } from "../../ports/payment";
import type {
  RegistrationContext,
  RegistrationOutcome,
  RegistrationStrategy,
} from "../types";

/**
 * Build the `paid_required` strategy around a payment verification port. The
 * client never asserts payment: verification is the port's job, and with the
 * deny-by-default port this mode always refuses (§3.2).
 */
export const createPaidRequiredStrategy = (
  payments: PaymentVerificationPort,
): RegistrationStrategy => ({
  mode: "paid_required",
  async validate(context: RegistrationContext): Promise<RegistrationOutcome> {
    const result = await payments.verify({
      email: context.email,
      reference: context.inviteCode,
    });

    if (!result.verified) {
      throw new ForbiddenError("A verified payment is required to register.", {
        code: "PAYMENT_REQUIRED",
      });
    }

    return { status: "active" };
  },
});
