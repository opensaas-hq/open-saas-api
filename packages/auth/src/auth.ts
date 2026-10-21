import type { Env } from "@opensaas/core";
import { getEnv, getTrustedOrigins } from "@opensaas/core";
import { type Database, db, schema } from "@opensaas/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization } from "better-auth/plugins";
import { type EmailSender, noopEmailSender } from "./ports/email";

/**
 * Drizzle executor the adapter can write through. A pooled `Database` and a
 * live transaction object both satisfy it, which is what lets registration run
 * Better Auth's writes inside **one** transaction (§3.1/§4.4).
 */
export type AuthDatabase =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Optional seams for {@link createAuth}. */
export type CreateAuthOptions = {
  /**
   * Outbound email port used by the verification and password-reset callbacks
   * (§3.4). Defaults to the non-delivering {@link noopEmailSender}; tests inject
   * a capturing fake.
   */
  emailSender?: EmailSender;
  /**
   * From address for outbound auth emails. Kept as an explicit option (not an
   * env var) because delivery is provider-specific and out of scope until the
   * messaging milestone.
   */
  emailFrom?: string;
};

/**
 * Build a Better Auth instance bound to a specific database executor and a
 * validated configuration. This is the factory form of the auth wiring
 * (formerly an import-time singleton — TD-05): callers pass the config and the
 * executor explicitly, so nothing is read at module scope.
 *
 * Passing a transaction object makes Better Auth's writes join that
 * transaction, so a caller can wrap sign-up + organization creation atomically.
 *
 * Hardening wired here (§3.4): the built-in rate limiter, `trustedOrigins`
 * (CSRF/origin allowlist), session lifetime policy, and email verification /
 * password reset through the injectable email port.
 */
export const createAuth = (
  env: Env,
  database: AuthDatabase = db,
  options: CreateAuthOptions = {},
) => {
  const emailSender = options.emailSender ?? noopEmailSender;
  const emailFrom = options.emailFrom ?? "auth@opensaas.local";

  return betterAuth({
    database: drizzleAdapter(database as Database, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Reject cookie-based requests from origins we did not allowlist. The same
    // list feeds the API CORS allowlist (§4.5).
    trustedOrigins: getTrustedOrigins(env),
    advanced: {
      // Better Auth silently disables origin checks when NODE_ENV=test. We want
      // the origin allowlist enforced in every environment, including tests, so
      // the check is never a runtime surprise (§3.4).
      disableOriginCheck: false,
    },
    // Built-in limiter, per auth route-class. Individual endpoints can override
    // the window/max; these are the conservative defaults (§3.4).
    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT_ENABLED,
      window: env.AUTH_RATE_LIMIT_WINDOW_S,
      max: env.AUTH_RATE_LIMIT_MAX,
    },
    session: {
      expiresIn: env.SESSION_EXPIRES_IN_S,
      updateAge: env.SESSION_UPDATE_AGE_S,
    },
    emailAndPassword: {
      enabled: true,
      // A password reset must invalidate every existing session so a leaked
      // session cannot outlive the credential change (§3.4).
      revokeSessionsOnPasswordReset: true,
      // Password reset ships with the mounted handler (§4.1); sending goes
      // through the injected port so tokens never reach the logs (§3.4 AC3).
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "Reset your password",
          text: `Use the following link to reset your password: ${url}`,
          url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // Verification email goes through the same injectable port (§3.4).
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "Verify your email address",
          text: `Use the following link to verify your email: ${url}`,
          url,
        });
      },
    },
    plugins: [
      organization(), // Better Auth native organization management
      bearer(), // API Keys / Bearer Token support for stateless requests
    ],
  });
};

/**
 * Process-wide auth instance built from the validated config. Kept for the
 * request-time surface (sessions, handler mounting); flows that need
 * transaction control build their own instance via {@link createAuth}.
 */
export const auth = createAuth(getEnv());
