import { zValidator } from "@hono/zod-validator";
import {
  createDatabaseInviteCodeValidator,
  createStrategyRegistry,
  registerUser,
} from "@opensaas/auth";
import { fail, fromZodError, ok, statusFromError } from "@opensaas/core";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { AppEnv } from "../types";

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

/**
 * Project-owned registration surface.
 *
 * It lives **outside** `/api/auth/*` on purpose: Better Auth owns that whole
 * prefix (§4.1), so a custom route below it would be shadowed by the
 * framework handler. The path is `/api/registration` (§4.1, path decision).
 */
export const registrationRouter = new Hono<AppEnv>();

registrationRouter.post(
  "/",
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

      // The registration service owns the whole flow: normalize + anti-abuse,
      // strategy validation (invite/payment, server-side), and persistence of
      // user, account, organization, owner membership and any waitlist row —
      // all in one transaction (§3.1).
      const result = await registerUser(
        {
          email: body.email,
          password: body.password,
          name: body.name,
          inviteCode: body.inviteCode,
        },
        // The registration mode comes from the validated config carried by the
        // request context, never from raw `process.env` (§4.2).
        { env: c.get("env"), registry: registrationRegistry },
      );

      return c.json(
        ok({
          email: result.email,
          status: result.status,
          message:
            result.status === "waitlist"
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
