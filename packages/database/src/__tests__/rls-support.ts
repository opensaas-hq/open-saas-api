import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** The three business tables protected by Row-Level Security (§2.5). */
export const BUSINESS_TABLES = ["contacts", "branches", "audit_log"] as const;

/** The dedicated runtime role RLS is enforced against. */
export const APP_ROLE = "opensaas_app";

/** The GUC the tenant-scoped transactions set, read by the policies. */
export const ORG_GUC = "app.current_org";

const sqlDir = join(import.meta.dir, "..", "..", "sql");

const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the RLS harness");
  return url;
};

/**
 * Run a trusted SQL script as an owner connection.
 *
 * Uses a dedicated `postgres` client (not the shared `db` handle): the shared
 * handle assumes the app role when `RLS_ENABLED` is on, which cannot exist yet
 * while we are still creating it — and cannot drop itself once teardown runs.
 */
const runScript = async (name: string): Promise<void> => {
  const client = postgres(databaseUrl(), { max: 1 });
  try {
    await client.unsafe(readFileSync(join(sqlDir, name), "utf8"));
  } finally {
    await client.end();
  }
};

/**
 * Apply the idempotent RLS bootstrap (`sql/rls-setup.sql`) to the test
 * database. Safe to call repeatedly; used by the RLS suites so they do not
 * depend on an external CI step having run first.
 */
export const applyRls = (): Promise<void> => runScript("rls-setup.sql");

/**
 * Reverse {@link applyRls} (`sql/rls-teardown.sql`) so a suite leaves the test
 * database in the un-bootstrapped state for the next run.
 */
export const teardownRls = (): Promise<void> => runScript("rls-teardown.sql");

/** Shape returned by the `rowsecurity` probe. */
export type RlsTableState = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
};

/**
 * Run a callback on a dedicated owner connection (never the RLS-bound shared
 * handle). Use this for assertions and DDL that must not be subject to RLS.
 */
export const asOwner = async <T>(
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> => {
  const client = postgres(databaseUrl(), { max: 1 });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

/**
 * Read the RLS flags for the business tables as an owner connection. The proof
 * suite asserts these are on at start, so a silently disabled setup fails
 * loudly instead of passing vacuously.
 */
export const readRlsState = async (): Promise<RlsTableState[]> => {
  return await asOwner(
    async (sql) =>
      (await sql`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname IN ('contacts', 'branches', 'audit_log')
        ORDER BY relname
      `) as unknown as RlsTableState[],
  );
};
