import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { type Database, getDb } from "../client";

/** The three business tables protected by Row-Level Security (§2.5). */
export const BUSINESS_TABLES = ["contacts", "branches", "audit_log"] as const;

/** The dedicated runtime role RLS is enforced against. */
export const APP_ROLE = "opensaas_app";

/** The GUC the tenant-scoped transactions set, read by the policies. */
export const ORG_GUC = "app.current_org";

const sqlDir = join(import.meta.dir, "..", "..", "sql");

const readScript = (name: string): string =>
  readFileSync(join(sqlDir, name), "utf8");

/**
 * Apply the idempotent RLS bootstrap (`sql/rls-setup.sql`) to the test
 * database. Safe to call repeatedly; used by the RLS suites so they do not
 * depend on an external CI step having run first.
 */
export const applyRls = async (database: Database = getDb()): Promise<void> => {
  await database.execute(sql.raw(readScript("rls-setup.sql")));
};

/**
 * Reverse {@link applyRls} (`sql/rls-teardown.sql`) so a suite leaves the test
 * database in the un-bootstrapped state for the next run.
 */
export const teardownRls = async (
  database: Database = getDb(),
): Promise<void> => {
  await database.execute(sql.raw(readScript("rls-teardown.sql")));
};

/** Shape returned by the `rowsecurity` probe. */
export type RlsTableState = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
};

/**
 * Read the RLS flags for the business tables. The proof suite asserts these are
 * on at start, so a silently disabled setup fails loudly instead of passing
 * vacuously.
 */
export const readRlsState = async (
  database: Database = getDb(),
): Promise<RlsTableState[]> => {
  const rows = await database.execute(sql`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('contacts', 'branches', 'audit_log')
    ORDER BY relname
  `);
  return rows as unknown as RlsTableState[];
};
