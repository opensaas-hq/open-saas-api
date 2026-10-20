import { zValidator } from "@hono/zod-validator";
import {
  type RegistrationMode,
  validateAndNormalizeEmail,
  validateRegistrationAccess,
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

/** Request schema for registration. Exported for direct unit testing. */
export const registerSchema = z.object({
  // Trim first, then validate the email format (Zod 4: `z.email()` checks
  // before a chained `.trim()`, so pipe the trimmed string into it).
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(8),
  name: z.string().min(1),
  inviteCode: z.string().optional(),
  hasPaid: z.boolean().optional(),
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

      // 3. Validate access based on the selected mode (public, waiting_list, invite_code, paid_required)
      const accessPolicy = await validateRegistrationAccess({
        mode: registrationMode,
        email: normalizedEmail,
        inviteCode: body.inviteCode,
        hasPaid: body.hasPaid,
      });

      // 4. Return the registration result in the standard envelope.
      return c.json(
        ok({
          email: normalizedEmail,
          status: accessPolicy.status,
          message:
            accessPolicy.status === "waitlist"
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
