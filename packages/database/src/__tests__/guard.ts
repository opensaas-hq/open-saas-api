import { afterAll, beforeAll, beforeEach } from "bun:test";
import { resetConfig } from "@opensaas/core";
import { sql } from "drizzle-orm";
import { close, db, resetDb } from "../client";

/**
 * Guard: integration tests must never touch the developer's database. The
 * database package runs with `.env.test`, where `DATABASE_URL` and
 * `DATABASE_URL_TEST` point at the same dedicated test database; if they
 * diverge, a test run would write to development data. Fail loudly and early.
 *
 * Reads `process.env` directly: `getEnv()` is memoized and other suites may
 * have re-initialized it with a synthetic config (TD-11).
 */
export const assertTestDatabase = (): void => {
  // Another suite may have re-initialized the memoized config with a synthetic
  // environment (TD-11). Drop it — and any handle built from it — so the lazy
  // client rebuilds from the real process environment, then verify the target.
  resetConfig();
  resetDb();

  const databaseUrl = process.env.DATABASE_URL;
  const testUrl = process.env.DATABASE_URL_TEST;

  if (!testUrl || databaseUrl !== testUrl) {
    throw new Error(
      "Refusing to run database tests: DATABASE_URL is not DATABASE_URL_TEST. " +
        "Run with `.env.test` (e.g. `bun run test:integration`).",
    );
  }
};

export const TRUNCATE_ALL = sql`
  TRUNCATE TABLE
    "audit_log",
    "contacts",
    "branches",
    "waitlist_entry",
    "registration_code",
    "member",
    "invitation",
    "organization",
    "account",
    "session",
    "verification",
    "user"
    RESTART IDENTITY CASCADE;
`;

/**
 * Install the isolation lifecycle for a writing suite: verify the target is the
 * test database once, truncate before every test, and truncate + release the
 * pool afterwards so back-to-back runs leave the database untouched.
 */
export const useTestDatabase = (): void => {
  beforeAll(assertTestDatabase);

  beforeEach(async () => {
    await db.execute(TRUNCATE_ALL);
  });

  afterAll(async () => {
    await db.execute(TRUNCATE_ALL);
    await close();
  });
};
