import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb } from "../client";
import { assertRlsEnforcement, checkRlsEnforcement } from "../client/rls";
import { assertTestDatabase } from "./guard";
import { APP_ROLE, applyRls, teardownRls } from "./rls-support";

/**
 * §2.5 — the boot check of the row-level-security enforcement.
 *
 * The check is what makes the "the tenancy boundary is enforced" claim
 * verifiable at runtime: the process proves, before serving traffic, that its
 * effective role cannot bypass the policies, that every protected table
 * enforces them, and that the tenant GUC round-trips.
 */
describe("@opensaas/database - RLS enforcement check (§2.5)", () => {
  const databaseUrl = process.env.DATABASE_URL;
  let appRoleDb: ReturnType<typeof createDb>;

  beforeAll(async () => {
    assertTestDatabase();

    if (!databaseUrl) throw new Error("DATABASE_URL is required");

    await applyRls();

    // The same handle the runtime builds when `RLS_ENABLED` is on: the
    // connection assumes the app role, so the policies apply to it.
    appRoleDb = createDb({
      databaseUrl,
      pool: {
        max: 1,
        idleTimeout: 1,
        statementTimeout: 5_000,
        connectTimeout: 5,
      },
      role: APP_ROLE,
    });
  });

  afterAll(async () => {
    if (appRoleDb) await appRoleDb.$client.end();
    await teardownRls();
  });

  test("the app role passes the check: the policies are really enforced", async () => {
    const report = await checkRlsEnforcement(appRoleDb);

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.role).toBe(APP_ROLE);
    expect(report.superuser).toBe(false);
    expect(report.bypassesRls).toBe(false);
    expect(report.gucRoundtrip).toBe(true);
    expect(report.tables).toHaveLength(3);
    for (const table of report.tables) {
      expect(table.enabled).toBe(true);
      expect(table.forced).toBe(true);
    }
  });

  test("the check passes the app role handle", async () => {
    const report = await assertRlsEnforcement(appRoleDb);

    expect(report.ok).toBe(true);
  });

  test("a superuser connection fails the check: it would bypass the policies", async () => {
    // The owner connection of the test database is a superuser, so it can read
    // every tenant. The check must refuse it.
    const ownerDb = createDb({
      databaseUrl: databaseUrl as string,
      pool: {
        max: 1,
        idleTimeout: 1,
        statementTimeout: 5_000,
        connectTimeout: 5,
      },
    });

    try {
      const report = await checkRlsEnforcement(ownerDb);

      expect(report.ok).toBe(false);
      expect(report.superuser).toBe(true);
      expect(report.problems.join(" ")).toContain("superuser");

      await expect(assertRlsEnforcement(ownerDb)).rejects.toThrow(
        /Row-level security is not enforced/,
      );
    } finally {
      await ownerDb.$client.end();
    }
  });

  test("the tenant GUC does not leak into the next transaction", async () => {
    // The check sets the GUC inside a transaction: the setting is local, so a
    // pooled connection never carries a tenant into the next request.
    const seen = await appRoleDb.execute(
      sql`SELECT current_setting('app.current_org', true) AS organization`,
    );

    const value = (seen as unknown as { organization: string | null }[])[0]
      ?.organization;

    // PostgreSQL resets a transaction-local GUC to an empty string when the
    // transaction ends. What matters is that the probe organization is gone:
    // the setting never survives the transaction it was set in.
    expect(value === null || value === "").toBe(true);
    expect(value).not.toBe("rls_probe_organization");
  });
});
