import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db, resetDb } from "../client";
import { assertTestDatabase } from "./guard";
import { type AppRoleClient, createAppRoleClient } from "./rls-harness";
import {
  BUSINESS_TABLES,
  applyRls,
  readRlsState,
  teardownRls,
} from "./rls-support";

/**
 * §2.5.3 — the "buggy query builder" proof. With RLS enabled and the app role
 * in use, cross-tenant access must fail **even when the SQL omits
 * `organization_id`**:
 *   * no GUC            -> zero rows (deny by default);
 *   * GUC = org A       -> only org A's rows, on all three business tables;
 *   * cross-tenant write-> rejected by `WITH CHECK`;
 *   * unfiltered UPDATE/DELETE -> limited to the current tenant;
 *   * a deliberately unfiltered repository-style query -> still isolated.
 *
 * The suite asserts `rowsecurity = true` at start, so a silently disabled setup
 * fails loudly instead of passing vacuously.
 */
describe("@opensaas/database - RLS cross-tenant proof (§2.5.3)", () => {
  const orgA = "rls_org_A";
  const orgB = "rls_org_B";
  let app: AppRoleClient;

  beforeAll(async () => {
    assertTestDatabase();

    // Apply the bootstrap while the handle is still the owner (the app role
    // does not exist yet, so a role-bound connection would fail at startup).
    await applyRls();

    // Now turn the flag on: reset the memoized config and handle so the runtime
    // connection assumes the app role and tenant transactions set the GUC.
    process.env.RLS_ENABLED = "true";
    const { resetConfig } = await import("@opensaas/core");
    resetConfig();
    resetDb();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    app = createAppRoleClient(databaseUrl);

    // Seed business rows for two tenants. Because FORCE RLS binds the owner
    // too, seeding sets the GUC per tenant — the same writability rule the app
    // role is subject to.
    await seedOrg(orgA, "contact-a");
    await seedOrg(orgB, "contact-b");
  });

  afterAll(async () => {
    if (app) await app.end();

    // Tear down as the owner: dropping the role is not something the app role
    // may do, and it must happen after its connections are closed.
    process.env.RLS_ENABLED = undefined;
    const { resetConfig } = await import("@opensaas/core");
    resetConfig();
    resetDb();
    await teardownRls();
  });

  const seedOrg = async (organizationId: string, contactName: string) => {
    // `organization` is a framework table, outside the RLS scope (§2.5), so it
    // is seeded as the owner without a tenant GUC.
    await db.execute(sql`
      INSERT INTO organization (id, name, slug)
      VALUES (${organizationId}, ${organizationId}, ${organizationId})
      ON CONFLICT (id) DO NOTHING
    `);

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_org', ${organizationId}, true)`,
      );
      await tx.execute(sql`
        INSERT INTO branches (organization_id, name)
        VALUES (${organizationId}, ${`branch-${organizationId}`})
      `);
      await tx.execute(sql`
        INSERT INTO contacts (organization_id, name)
        VALUES (${organizationId}, ${contactName})
      `);
      await tx.execute(sql`
        INSERT INTO audit_log (action, entity_type, entity_id, actor_id, organization_id)
        VALUES ('seeded', 'contact', 'seed', 'actor', ${organizationId})
      `);
    });
  };

  test("RLS is actually on for all three tables (guard against a silent off)", async () => {
    const state = await readRlsState();
    expect(state).toHaveLength(BUSINESS_TABLES.length);
    for (const row of state) {
      expect(row.relrowsecurity).toBe(true);
    }
  });

  test("a query with no GUC returns zero rows on every business table", async () => {
    for (const table of BUSINESS_TABLES) {
      const rows = await app.raw((tx) => tx.unsafe(`SELECT * FROM ${table}`));
      expect(rows, `${table} should be empty without a tenant`).toHaveLength(0);
    }
  });

  test("with the GUC set, the app role reads only the current tenant's rows", async () => {
    for (const table of BUSINESS_TABLES) {
      const rowsA = (await app.asTenant(orgA, (tx) =>
        tx.unsafe(`SELECT organization_id FROM ${table}`),
      )) as { organization_id: string }[];
      const rowsB = (await app.asTenant(orgB, (tx) =>
        tx.unsafe(`SELECT organization_id FROM ${table}`),
      )) as { organization_id: string }[];

      expect(rowsA.length).toBeGreaterThan(0);
      expect(rowsA.every((r) => r.organization_id === orgA)).toBe(true);
      expect(rowsB.every((r) => r.organization_id === orgB)).toBe(true);
    }
  });

  test("a cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await expect(
      app.asTenant(orgA, (tx) =>
        tx.unsafe(
          `INSERT INTO contacts (organization_id, name) VALUES ($1, 'spoof')`,
          [orgB],
        ),
      ),
    ).rejects.toThrow();
  });

  test("an unfiltered UPDATE only touches the current tenant's rows", async () => {
    // Rename every contact the app role can see while scoped to org A.
    const updated = (await app.asTenant(orgA, (tx) =>
      tx.unsafe(
        `UPDATE contacts SET name = 'renamed' RETURNING organization_id`,
      ),
    )) as { organization_id: string }[];

    expect(updated.length).toBeGreaterThan(0);
    expect(updated.every((r) => r.organization_id === orgA)).toBe(true);

    // org B's row is untouched.
    const [b] = (await app.asTenant(orgB, (tx) =>
      tx.unsafe("SELECT name FROM contacts"),
    )) as { name: string }[];
    expect(b?.name).toBe("contact-b");
  });

  test("an unfiltered DELETE cannot remove another tenant's rows", async () => {
    const beforeB = await app.asTenant(orgB, (tx) =>
      tx.unsafe("SELECT * FROM contacts"),
    );

    await app.asTenant(orgA, (tx) => tx.unsafe("DELETE FROM contacts"));

    const rowsA = await app.asTenant(orgA, (tx) =>
      tx.unsafe("SELECT * FROM contacts"),
    );
    const afterB = await app.asTenant(orgB, (tx) =>
      tx.unsafe("SELECT * FROM contacts"),
    );

    expect(rowsA).toHaveLength(0);
    expect(afterB).toHaveLength(beforeB.length);
  });

  test("a buggy (filter-less) repository query is still isolated", async () => {
    // Simulates application code that forgot `WHERE organization_id = ...`:
    // the database, not the query builder, must enforce the boundary.
    await seedOrg(orgA, "reprobe-a");
    const leaked = (await app.asTenant(orgB, (tx) =>
      tx.unsafe("SELECT organization_id FROM contacts"),
    )) as { organization_id: string }[];

    expect(leaked.every((r) => r.organization_id === orgB)).toBe(true);
  });

  test("the runtime tenant helper sets the GUC for the operation (§2.5.2)", async () => {
    const { runInTenantContext } = await import("../client");
    const seen = await runInTenantContext({
      organizationId: orgA,
      run: async (tx) => {
        const rows = await tx.execute(
          sql`SELECT current_setting('app.current_org', true) AS org`,
        );
        return (rows as unknown as { org: string }[])[0]?.org;
      },
    });

    expect(seen).toBe(orgA);
  });

  test("the GUC never leaks across sequential tenant transactions", async () => {
    const { runInTenantContext } = await import("../client");

    const readOrg = async (organizationId: string) =>
      await runInTenantContext({
        organizationId,
        run: async (tx) => {
          const rows = await tx.execute(
            sql`SELECT organization_id FROM contacts`,
          );
          return (rows as unknown as { organization_id: string }[]).map(
            (r) => r.organization_id,
          );
        },
      });

    await seedOrg(orgA, "seq-a");
    await seedOrg(orgB, "seq-b");

    const first = await readOrg(orgA);
    const second = await readOrg(orgB);
    const third = await readOrg(orgA);

    expect(first.every((id) => id === orgA)).toBe(true);
    expect(second.every((id) => id === orgB)).toBe(true);
    expect(third.every((id) => id === orgA)).toBe(true);
  });
});
