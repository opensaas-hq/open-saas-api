import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { assertTestDatabase } from "./guard";
import {
  APP_ROLE,
  BUSINESS_TABLES,
  applyRls,
  asOwner,
  readRlsState,
  teardownRls,
} from "./rls-support";

/**
 * §2.5.1 — the RLS bootstrap itself: the app role is a plain login role with no
 * escape hatch, the business tables are enabled + forced, and the owner can
 * still administer them.
 *
 * Runs with the bootstrap applied to the test database; it applies and removes
 * it itself so it does not depend on an external CI step. All assertions use a
 * dedicated owner connection, so the result does not depend on `RLS_ENABLED`.
 */
describe("@opensaas/database - RLS bootstrap (§2.5.1)", () => {
  beforeAll(async () => {
    assertTestDatabase();
    await applyRls();
  });

  afterAll(async () => {
    await teardownRls();
  });

  test("the app role exists, can log in, and has no RLS escape hatch", async () => {
    const [role] = await asOwner(
      async (sql) =>
        (await sql`
          SELECT rolsuper, rolbypassrls, rolcanlogin
          FROM pg_roles WHERE rolname = ${APP_ROLE}
        `) as unknown as {
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcanlogin: boolean;
        }[],
    );

    expect(role).toBeDefined();
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
    expect(role?.rolcanlogin).toBe(true);
  });

  test("the app role does not own the business tables", async () => {
    const rows = await asOwner(
      async (sql) =>
        (await sql`
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename IN ('contacts', 'branches', 'audit_log')
            AND tableowner = ${APP_ROLE}
        `) as unknown as { tablename: string }[],
    );

    expect(rows).toEqual([]);
  });

  test("RLS is enabled and forced on all three business tables", async () => {
    const state = await readRlsState();

    expect(state.map((row) => row.relname)).toEqual(
      [...BUSINESS_TABLES].sort(),
    );
    for (const row of state) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  test("each business table carries the tenant_isolation policy", async () => {
    const rows = await asOwner(
      async (sql) =>
        (await sql`
          SELECT tablename
          FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
          ORDER BY tablename
        `) as unknown as { tablename: string }[],
    );

    expect(rows.map((row) => row.tablename)).toEqual(
      [...BUSINESS_TABLES].sort(),
    );
  });

  test("the owner role can still administer the tables (DDL works)", async () => {
    // The owner keeps full DDL rights: FORCE RLS binds it to the policies, but
    // it can still ALTER the table. Use a harmless, reversible statement.
    await asOwner(async (sql) => {
      await sql`ALTER TABLE branches ADD COLUMN _rls_probe_ text`;
      await sql`ALTER TABLE branches DROP COLUMN _rls_probe_`;
    });

    const [column] = await asOwner(
      async (sql) =>
        (await sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'branches' AND column_name = '_rls_probe_'
        `) as unknown as { column_name: string }[],
    );
    expect(column).toBeUndefined();
  });
});
