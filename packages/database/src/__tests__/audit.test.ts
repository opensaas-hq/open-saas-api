import { describe, expect, test } from "bun:test";
import { type AuditEvent, REDACTED } from "@opensaas/core";
import { DatabaseAuditRepository, listAuditRows } from "../repositories/audit";
import { createOrganization } from "../repositories/organization";
import { useTestDatabase } from "./setup";

useTestDatabase();

const createOrg = async (suffix: string, label: string) => {
  const id = `org_${label}_${suffix}`;
  await createOrganization({ id, name: label, slug: `${label}-${suffix}` });
  return id;
};

const event = (organizationId: string): AuditEvent => ({
  action: "contact.updated",
  entityType: "contact",
  entityId: "contact-1",
  actorId: "user-1",
  organizationId,
  changes: { name: { before: "Ada", after: "Ada Lovelace" } },
  timestamp: new Date().toISOString(),
});

describe("@opensaas/database - Audit repository", () => {
  const suffix = Date.now().toString();

  test("record persists a row with actor, tenant, action and diff", async () => {
    const orgId = await createOrg(suffix, "auditrec");
    const repo = new DatabaseAuditRepository();

    await repo.record(event(orgId));

    const rows = await listAuditRows({
      organizationId: orgId,
      entityType: "contact",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe("user-1");
    expect(rows[0]?.organizationId).toBe(orgId);
    expect(rows[0]?.action).toBe("contact.updated");
    expect(rows[0]?.changes).toEqual({
      name: { before: "Ada", after: "Ada Lovelace" },
    });
  });

  test("recordMany persists a batch in one call", async () => {
    const orgId = await createOrg(suffix, "auditmany");
    const repo = new DatabaseAuditRepository();

    await repo.recordMany([
      { ...event(orgId), entityId: "c-1" },
      { ...event(orgId), entityId: "c-2" },
    ]);

    const rows = await listAuditRows({ organizationId: orgId });
    expect(rows).toHaveLength(2);
  });

  test("sensitive keys are redacted before the row is stored", async () => {
    const orgId = await createOrg(suffix, "auditredact");
    const repo = new DatabaseAuditRepository();

    await repo.record({
      ...event(orgId),
      metadata: { token: "jwt-secret", note: "visible" },
    });

    const rows = await listAuditRows({ organizationId: orgId });
    expect(rows[0]?.metadata).toEqual({ token: REDACTED, note: "visible" });
  });
});
