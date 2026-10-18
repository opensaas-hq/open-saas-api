import { ForbiddenError, ValidationError } from "@opensaas/core";

export type RegistrationMode =
  | "public"
  | "waiting_list"
  | "invite_code"
  | "paid_required";

export interface RegistrationContext {
  mode: RegistrationMode;
  email: string;
  inviteCode?: string;
  hasPaid?: boolean;
}

/**
 * Validates whether a user can register based on the configured registration mode.
 * Throws appropriate domain errors if constraints are not met.
 */
export function validateRegistrationAccess(context: RegistrationContext): {
  status: "active" | "waitlist";
} {
  const mode = context.mode ?? "public";

  switch (mode) {
    case "public":
      // Public mode allows instant access
      return { status: "active" };

    case "waiting_list":
      // Waiting list mode registers the user but assigns them to a waitlist status
      return { status: "waitlist" };

    case "invite_code":
      if (!context.inviteCode || context.inviteCode.trim() === "") {
        throw new ValidationError(
          "An invitation code is required to register.",
          {
            field: "inviteCode",
            code: "INVITE_CODE_REQUIRED",
          },
        );
      }
      // Here you would typically validate the code against database repository
      return { status: "active" };

    case "paid_required":
      if (!context.hasPaid) {
        throw new ForbiddenError(
          "A completed payment or active checkout session is required to register.",
          {
            code: "PAYMENT_REQUIRED",
          },
        );
      }
      return { status: "active" };

    default:
      throw new ValidationError(`Unsupported registration mode: ${mode}`, {
        field: "mode",
        code: "INVALID_REGISTRATION_MODE",
      });
  }
}
