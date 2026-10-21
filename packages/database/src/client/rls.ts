import { ServiceUnavailableError } from "@opensaas/core";
import { sql } from "drizzle-orm";
import type { Database } from "../client";

/**
 * The business tables protected by row-level security (§2.5). They are the
 * tables the runtime role must never be able to read across tenants.
 */
export const RLS_PROTECTED_TABLES = [
  "contacts",
  "branches",
  "audit_log",
] as const;

/** The enforcement state of one protected table. */
export type RlsTableState = {
  /** Name of the table. */
  name: string;
  /** True when `ENABLE ROW LEVEL SECURITY` is set. */
  enabled: boolean;
  /** True when `FORCE ROW LEVEL SECURITY` is set (the owner is bound too). */
  forced: boolean;
};

/** The outcome of the enforcement check. */
export type RlsEnforcementReport = {
  /** True when every check passed. */
  ok: boolean;
  /** The role the connection actually runs as. */
  role: string;
  /** True when the role is a superuser: it would ignore the policies. */
  superuser: boolean;
  /** True when the role carries `BYPASSRLS`: it would ignore the policies. */
  bypassesRls: boolean;
  /** The state of every protected table. */
  tables: RlsTableState[];
  /** True when the tenant GUC can be set and read back inside a transaction. */
  gucRoundtrip: boolean;
  /** One human-readable line per problem found. */
  problems: string[];
};

/** The GUC the policies read (§2.5.1). */
const TENANT_GUC = "app.current_org";

/**
 * Set the tenant GUC inside a transaction and read it back, to prove the
 * mechanism the runtime depends on actually works on this connection.
 *
 * The setting is transaction-local (`set_config(..., true)`), so it is dropped
 * when the transaction ends and can never leak onto a pooled connection.
 */
const checkGucRoundtrip = async (db: Database): Promise<boolean> => {
  const probe = "rls_probe_organization";

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config(${TENANT_GUC}, ${probe}, true)`);

    const rows = (await tx.execute(
      sql`SELECT current_setting(${TENANT_GUC}, true) AS organization`,
    )) as unknown as { organization: string | null }[];

    return rows[0]?.organization === probe;
  });
};

/**
 * Verify that row-level security is really enforced on this connection.
 *
 * The check is deliberately pessimistic: it fails when anything is missing, so
 * a misconfigured deployment stops at boot instead of serving traffic with the
 * tenancy boundary unenforced. It verifies:
 *
 * 1. the effective role is neither a superuser nor a `BYPASSRLS` role — both
 *    would ignore the policies;
 * 2. every protected table has `ENABLE` **and** `FORCE` row-level security;
 * 3. the tenant GUC can be set and read back in a transaction — the mechanism
 *    the policies rely on.
 */
export const checkRlsEnforcement = async (
  db: Database,
): Promise<RlsEnforcementReport> => {
  const problems: string[] = [];

  const roleRows = (await db.execute(sql`
    SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls
    FROM pg_roles r
    WHERE r.rolname = current_user
  `)) as unknown as {
    role: string;
    superuser: boolean;
    bypassrls: boolean;
  }[];

  const role = roleRows[0];
  const superuser = role?.superuser ?? false;
  const bypassesRls = role?.bypassrls ?? false;

  if (!role) {
    problems.push("the current role could not be read from pg_roles");
  }

  if (superuser) {
    problems.push(
      `the role "${role.role}" is a superuser: it ignores the row-level policies`,
    );
  }

  if (bypassesRls) {
    problems.push(
      `the role "${role.role}" carries BYPASSRLS: it ignores the row-level policies`,
    );
  }

  const tableRows = (await db.execute(sql`
    SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
    FROM pg_class c
    WHERE c.relname IN ('contacts', 'branches', 'audit_log')
  `)) as unknown as {
    name: string;
    enabled: boolean;
    forced: boolean;
  }[];

  const tables: RlsTableState[] = RLS_PROTECTED_TABLES.map((name) => {
    const found = tableRows.find((row) => row.name === name);

    if (!found) {
      problems.push(`the table "${name}" does not exist`);
      return { name, enabled: false, forced: false };
    }

    if (!found.enabled) {
      problems.push(`the table "${name}" does not enable row-level security`);
    }

    if (!found.forced) {
      problems.push(
        `the table "${name}" does not force row-level security: its owner would bypass the policies`,
      );
    }

    return { name, enabled: found.enabled, forced: found.forced };
  });

  const gucRoundtrip = await checkGucRoundtrip(db);

  if (!gucRoundtrip) {
    problems.push(
      `the tenant GUC "${TENANT_GUC}" cannot be set and read back in a transaction`,
    );
  }

  return {
    ok: problems.length === 0,
    role: role?.role ?? "unknown",
    superuser,
    bypassesRls,
    tables,
    gucRoundtrip,
    problems,
  };
};

/**
 * Assert that row-level security is enforced, or fail with a typed 503.
 *
 * Used at boot: a process that cannot prove the tenancy boundary is enforced
 * must not serve traffic.
 */
export const assertRlsEnforcement = async (
  db: Database,
): Promise<RlsEnforcementReport> => {
  const report = await checkRlsEnforcement(db);

  if (!report.ok) {
    throw new ServiceUnavailableError(
      "Row-level security is not enforced on this connection",
      {
        reason: "rls_not_enforced",
        role: report.role,
        problems: report.problems,
      },
    );
  }

  return report;
};
