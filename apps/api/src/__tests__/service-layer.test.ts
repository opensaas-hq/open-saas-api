import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEvent, AuditPort } from "@opensaas/core";
import {
  createBranch,
  db,
  listAuditRows,
  schema,
  withRawTransaction,
} from "@opensaas/database";
import { createBranchesService } from "../services/branches.service";
import { createContactsService } from "../services/contacts.service";
import {
  APP_ORIGIN,
  createTenant,
  createTestApp,
  hasTestDatabase,
  jsonHeaders,
} from "./support/app";

/**
 * The service layer, the DTOs and the audit trail (§4.4).
 *
 * These tests cover the guarantees the HTTP layer used to break: every
 * mutation is audited with its acting user and its tenant, a bulk import is
 * atomic, and a payload that exceeds the documented caps is refused instead of
 * being stored.
 */
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

/** Unique slug per test, so the suites never collide on the unique column. */
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A sink that fails on purpose, to prove the rollback of a transaction. */
const failingAuditPort: AuditPort = {
  async record(_event: AuditEvent): Promise<void> {
    throw new Error("the audit sink is unavailable");
  },
  async recordMany(_events: AuditEvent[]): Promise<void> {
    throw new Error("the audit sink is unavailable");
  },
};

describeIfDb("Apps/API - Service layer, DTOs and audit trail (§4.4)", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        `TRUNCATE TABLE registration_code, waitlist_entry, "member", "organization",
         "account", "session", "verification", "user", branches, contacts, audit_log
         RESTART IDENTITY CASCADE`,
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("a created contact is audited with the acting user and the tenant", async () => {
    const { app } = createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });
    const tenant = await createTenant(app, {
      email: "audit@example.com",
      password: "password123",
      name: "Audit User",
      slug: uniqueSlug("audit"),
    });

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        method: "POST",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "Audited Contact" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };

    const rows = await listAuditRows({
      organizationId: tenant.organizationId,
      entityType: "contact",
      entityId: body.data.id,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("contact.created");
    expect(rows[0]?.actorId).toBe(tenant.userId);
    expect(rows[0]?.organizationId).toBe(tenant.organizationId);
  });

  test("a registration is audited with the new user and its organization", async () => {
    const { app } = createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });
    const email = `registered-${Date.now().toString(36)}@example.com`;

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/registration`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email,
          password: "password123",
          name: "Registered User",
        }),
      }),
    );

    expect(res.status).toBe(201);

    const users = (await db.select().from(schema.user)).filter(
      (user) => user.email === email,
    );
    expect(users).toHaveLength(1);

    const events = (await db.select().from(schema.auditLog)).filter(
      (event) => event.action === "registration.completed",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe(users[0]?.id);
    expect(events[0]?.organizationId).toBeTruthy();
  });

  test("a bulk import that fails to audit leaves no contact behind", async () => {
    const { app } = createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });
    const tenant = await createTenant(app, {
      email: "bulk@example.com",
      password: "password123",
      name: "Bulk User",
      slug: uniqueSlug("bulk"),
    });

    // The audit sink fails inside the transaction: the whole batch has to be
    // rolled back, leaving zero partial rows.
    const service = createContactsService({
      branches: createBranchesService(),
      audit: failingAuditPort,
      auditInTransaction: () => failingAuditPort,
    });

    await expect(
      service.bulkCreate({
        organizationId: tenant.organizationId,
        actorId: tenant.userId,
        contacts: [{ name: "First" }, { name: "Second" }],
      }),
    ).rejects.toThrow("the audit sink is unavailable");

    const contacts = await db.select().from(schema.contacts);
    expect(contacts).toHaveLength(0);

    const events = await db.select().from(schema.auditLog);
    expect(events).toHaveLength(0);
  });

  test("a successful bulk import writes the contacts and their audit rows", async () => {
    const { app } = createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });
    const tenant = await createTenant(app, {
      email: "bulk-ok@example.com",
      password: "password123",
      name: "Bulk Ok",
      slug: uniqueSlug("bulk-ok"),
    });

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts/bulk`, {
        method: "POST",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({
          contacts: [{ name: "First" }, { name: "Second" }],
        }),
      }),
    );

    expect(res.status).toBe(201);

    const contacts = await db.select().from(schema.contacts);
    expect(contacts).toHaveLength(2);

    const events = (await db.select().from(schema.auditLog)).filter(
      (event) => event.action === "contact.created",
    );
    expect(events).toHaveLength(2);
  });

  test("a contact without a branch belongs to the branch of the request", async () => {
    const { app } = createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });
    const tenant = await createTenant(app, {
      email: "branch@example.com",
      password: "password123",
      name: "Branch User",
      slug: uniqueSlug("branch"),
    });

    const branch = await createBranch({
      organizationId: tenant.organizationId,
      name: "Request Branch",
    });

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        method: "POST",
        headers: {
          ...jsonHeaders(tenant.cookie),
          "x-branch-id": branch?.id ?? "",
        },
        body: JSON.stringify({ name: "Contact Of The Branch" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { branchId: string | null } };
    expect(body.data.branchId).toBe(branch?.id);
  });

  test("a metadata payload over the documented caps is refused with 422", async () => {
    const { app } = createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });
    const tenant = await createTenant(app, {
      email: "metadata@example.com",
      password: "password123",
      name: "Metadata User",
      slug: uniqueSlug("metadata"),
    });

    const post = async (metadata: Record<string, unknown>) =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts`, {
          method: "POST",
          headers: jsonHeaders(tenant.cookie),
          body: JSON.stringify({ name: "Capped", metadata }),
        }),
      );

    // Deeper than the maximum depth.
    const tooDeep = await post({ a: { b: { c: { d: 1 } } } });
    expect(tooDeep.status).toBe(422);
    const deepBody = (await tooDeep.json()) as {
      error?: { code?: string; details?: { fieldErrors?: unknown } };
    };
    expect(deepBody.error?.code).toBe("VALIDATION_ERROR");

    // Bigger than the maximum size.
    const tooBig = await post({ blob: "x".repeat(9_000) });
    expect(tooBig.status).toBe(422);

    // Nothing was stored.
    const contacts = await db.select().from(schema.contacts);
    expect(contacts).toHaveLength(0);
  });
});

describe("Apps/API - The routes are thin adapters (§4.4)", () => {
  test("no route imports the database package", async () => {
    const routesDir = join(import.meta.dir, "..", "routes");
    const files = await readdir(routesDir);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      if (!file.endsWith(".ts")) continue;

      const source = await readFile(join(routesDir, file), "utf8");
      expect(source).not.toContain("@opensaas/database");
    }
  });
});
