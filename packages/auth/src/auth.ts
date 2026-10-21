import type { Env } from "@opensaas/core";
import { getEnv } from "@opensaas/core";
import { type Database, db, schema } from "@opensaas/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization } from "better-auth/plugins";

/**
 * Drizzle executor the adapter can write through. A pooled `Database` and a
 * live transaction object both satisfy it, which is what lets registration run
 * Better Auth's writes inside **one** transaction (§3.1/§4.4).
 */
export type AuthDatabase =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Build a Better Auth instance bound to a specific database executor and a
 * validated configuration. This is the factory form of the auth wiring
 * (formerly an import-time singleton — TD-05): callers pass the config and the
 * executor explicitly, so nothing is read at module scope.
 *
 * Passing a transaction object makes Better Auth's writes join that
 * transaction, so a caller can wrap sign-up + organization creation atomically.
 */
export const createAuth = (env: Env, database: AuthDatabase = db) =>
  betterAuth({
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
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      organization(), // Better Auth native organization management
      bearer(), // API Keys / Bearer Token support for stateless requests
    ],
  });

/**
 * Process-wide auth instance built from the validated config. Kept for the
 * request-time surface (sessions, handler mounting); flows that need
 * transaction control build their own instance via {@link createAuth}.
 */
export const auth = createAuth(getEnv());
