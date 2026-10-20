import { zValidator } from "@hono/zod-validator";
import {
  type RegistrationMode,
  createDatabaseInviteCodeValidator,
  createStrategyRegistry,
  validateAndNormalizeEmail,
} from "@opensaas/auth";
import {
  fail,
  fromZodError,
  getEnv,
  ok,
  statusFromError,
} from "@opensaas/core";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/**
 * Request schema for registration. Exported for direct unit testing.
 *
 * Deliberately has **no** payment field: a client can never assert that it has
 * paid (§3.2). Payment, when required, is verified server-side through the
 * `PaymentVerificationPort`.
 */
export const registerSchema = z.object({
  // Trim first, then validate the email format (Zod 4: `z.email()` checks
  // before a chained `.trim()`, so pipe the trimmed string into it).
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(8),
  name: z.string().min(1),
  inviteCode: z.string().optional(),
});

// Strategies are stateless; one registry per process is enough. Invite codes
// are validated against the database; payment verification stays
// deny-by-default until a provider is integrated (§3.2).
const registrationRegistry = createStrategyRegistry({
  inviteCodes: createDatabaseInviteCodeValidator(),
});

export const authRouter = new Hono();

authRouter.post(
  "/register",
  zValidator("json", registerSchema, (result, c) => {
    if (!result.success) {
      const error = fromZodError(result.error, "Invalid registration payload");
      return c.json(
        fail(error),
        statusFromError(error) as ContentfulStatusCode,
      );
    }
  }),
  async (c) => {
    try {
      const body = c.req.valid("json");

      // 1. Enforce email anti-abuse and normalization policy
      const normalizedEmail = validateAndNormalizeEmail(body.email);

      // 2. Determine system registration mode from validated configuration
      //    (never raw `process.env`; an invalid value already failed at boot).
      const registrationMode = getEnv().REGISTRATION_MODE as RegistrationMode;

      // 3. Resolve the mode's strategy and validate server-side. The strategy
      //    owns the mode's constraint (invite code checked against the DB,
      //    payment verified through the port) — request flags are never trusted.
      const outcome = await registrationRegistry
        .require(registrationMode)
        .validate({
          mode: registrationMode,
          email: normalizedEmail,
          inviteCode: body.inviteCode,
        });

      // 4. Return the registration result in the standard envelope.
      return c.json(
        ok({
          email: normalizedEmail,
          status: outcome.status,
          message:
            outcome.status === "waitlist"
              ? "Registration received. You have been added to the waitlist."
              : "Registration successful.",
        }),
        201,
      );
    } catch (error: unknown) {
      // Preserve the original status: a typed AppError keeps its code and
      // status, and anything else maps to 500 via the single status helper, so
      // a real server fault is never masked as a 400.
      const statusCode = statusFromError(error) as ContentfulStatusCode;
      const err = error as { code?: string; message?: string };
      return c.json(
        fail(
          err.code ?? "REGISTRATION_FAILED",
          err.message ?? "An unexpected error occurred",
        ),
        statusCode,
      );
    }
  },
);
