import { createAuth } from "@opensaas/auth";
import { type Env, createEnv, createLogger } from "@opensaas/core";
import { db } from "@opensaas/database";
import type { Hono } from "hono";
import { createApp } from "../../app";
import type { AppEnv } from "../../types";

/**
 * Origin used by the app-level tests. It matches `BETTER_AUTH_URL` so the
 * Better Auth origin check (§3.4) accepts the cookie-based flows.
 */
export const APP_ORIGIN = "http://localhost:3015";

/**
 * Base configuration for the app-level tests: the real test database and a
 * known secret. The database URL falls back to an unreachable placeholder so
 * building an app never throws when no test database is configured — the
 * database-dependent suites are skipped in that case.
 */
const baseEnvSource: Record<string, unknown> = {
  NODE_ENV: "test",
  PORT: "3015",
  LOG_LEVEL: "error",
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/opensaas_unused",
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: APP_ORIGIN,
  REGISTRATION_MODE: "public",
  AUTH_RATE_LIMIT_ENABLED: "false",
};

/**
 * True when the run has a dedicated test database (`DATABASE_URL` equals
 * `DATABASE_URL_TEST`), i.e. when the integration suites may run (§2.7).
 */
export const hasTestDatabase = (): boolean =>
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

/** An app instance plus the dependencies it was built with. */
export type TestApp = {
  app: Hono<AppEnv>;
  env: Env;
};

/**
 * Build an app bound to a specific configuration (§4.7).
 *
 * Every dependency is injected, so a test can pick a registration mode, a rate
 * limit or any other knob without touching the process environment.
 */
export const createTestApp = (overrides: Partial<Env> = {}): TestApp => {
  const env = createEnv({ ...baseEnvSource, ...overrides });
  const logger = createLogger(env);
  const auth = createAuth(env, db);

  return { app: createApp({ env, db, auth, logger }), env };
};

/**
 * Extract the cookies of a response as a `Cookie` header value, so the next
 * request can replay the session.
 */
export const cookieHeader = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((cookie) => cookie !== "")
    .join("; ");

/** Headers a browser-style request carries, including the trusted origin. */
export const jsonHeaders = (cookie?: string): Record<string, string> => ({
  "content-type": "application/json",
  origin: APP_ORIGIN,
  ...(cookie ? { cookie } : {}),
});

/** Credentials used by the test helpers. */
export type TestUser = {
  email: string;
  password: string;
  name: string;
};

/**
 * Sign up through the mounted Better Auth surface and return the response
 * together with the session cookie it set (§4.1).
 */
export const signUp = async (
  app: Hono<AppEnv>,
  user: TestUser,
): Promise<{ res: Response; cookie: string }> => {
  const res = await app.fetch(
    new Request(`${APP_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(user),
    }),
  );

  return { res, cookie: cookieHeader(res) };
};

/** Sign in through the mounted Better Auth surface. */
export const signIn = async (
  app: Hono<AppEnv>,
  user: Pick<TestUser, "email" | "password">,
): Promise<{ res: Response; cookie: string }> => {
  const res = await app.fetch(
    new Request(`${APP_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(user),
    }),
  );

  return { res, cookie: cookieHeader(res) };
};

/**
 * Create an organization for the signed-up user and make it the active one.
 *
 * The organization plugin creates the organization and its `owner` membership,
 * and sets the active organization on the session, so the tenant-scoped
 * routes become reachable with the same cookie.
 */
export const createOrganization = async (
  app: Hono<AppEnv>,
  cookie: string,
  organization: { name: string; slug: string },
): Promise<Response> =>
  await app.fetch(
    new Request(`${APP_ORIGIN}/api/auth/organization/create`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify(organization),
    }),
  );
