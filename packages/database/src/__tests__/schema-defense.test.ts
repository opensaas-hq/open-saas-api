import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../client";
import { createContact } from "../repositories/contact";
import { createOrganization } from "../repositories/organization";
import { contacts, organization } from "../schema";
import { useTestDatabase } from "./setup";

useTestDatabase();

const createOrg = async (suffix: string, label: string) => {
  const id = `org_${label}_${suffix}`;
  await createOrganization({ id, name: label, slug: `${label}-${suffix}` });
  return id;
};

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a row");
  return value;
};

describe("@opensaas/database - Schema defense in depth", () => {
  const suffix = Date.now().toString();

  test("updatedAt is maintained on update without the caller setting it", async () => {
    const orgId = await createOrg(suffix, "schemameta");

    const created = required(
      await createContact({
        organizationId: orgId,
        name: "Before",
      }),
    );

    // Let the clock advance so a second timestamp is observably different.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [updated] = await db
      .update(contacts)
      .set({ name: "After" })
      .where(eq(contacts.id, created.id))
      .returning();

    expect(updated?.name).toBe("After");
    expect(required(updated).updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime(),
    );
  });

  test("a duplicate contact email within one organization is rejected by the DB", async () => {
    const orgId = await createOrg(suffix, "schemaemail");
    const email = `dupe_${suffix}@x.co`;

    await createContact({ organizationId: orgId, name: "First", email });

    // Bypass the repository and hit the database directly: the unique partial
    // index, not application code, must reject the duplicate.
    await expect(
      (async () =>
        db
          .insert(contacts)
          .values({ organizationId: orgId, name: "Second", email }))(),
    ).rejects.toThrow();
  });

  test("the same email is allowed in a different organization", async () => {
    const orgA = await createOrg(suffix, "schemaemailA");
    const orgB = await createOrg(suffix, "schemaemailB");
    const email = `shared_${suffix}@x.co`;

    await createContact({ organizationId: orgA, name: "A", email });
    const b = await createContact({ organizationId: orgB, name: "B", email });

    expect(b?.email).toBe(email);
  });

  test("an invalid status is rejected at the database level", async () => {
    const orgId = await createOrg(suffix, "schemastatus");

    await expect(
      (async () =>
        db.execute(
          sql`INSERT INTO contacts (organization_id, name, status) VALUES (${orgId}, 'Bad', 'bogus')`,
        ))(),
    ).rejects.toThrow();
  });

  test("organization.metadata round-trips as JSON", async () => {
    const id = `org_jsonb_${suffix}`;
    const metadata = { tier: "pro", seats: 12, flags: ["beta"] };

    await createOrganization({ id, name: "Json", slug: `json-${suffix}` });

    await db
      .update(organization)
      .set({ metadata })
      .where(eq(organization.id, id));

    const [row] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, id));

    expect(row?.metadata).toEqual(metadata);
  });
});
