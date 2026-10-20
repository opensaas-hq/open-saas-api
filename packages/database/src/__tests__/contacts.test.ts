import { describe, expect, test } from "bun:test";
import { withTransaction } from "../client";
import {
  createContact,
  createContactsBulk,
  getContactsByOrganization,
} from "../repositories/contact";
import { createOrganization } from "../repositories/organization";
import "./setup";

const createOrg = async (suffix: string, label: string) => {
  const id = `org_${label}_${suffix}`;
  await createOrganization({ id, name: label, slug: `${label}-${suffix}` });
  return id;
};

describe("@opensaas/database - Contact repository", () => {
  const suffix = Date.now().toString();

  test("exposes the repository functions", () => {
    expect(createContact).toBeDefined();
    expect(getContactsByOrganization).toBeDefined();
    expect(createContactsBulk).toBeDefined();
  });

  test("creates a contact scoped to its organization", async () => {
    const orgId = await createOrg(suffix, "orgcreate");

    const contact = await createContact({
      organizationId: orgId,
      name: "Ada",
      email: `ada_${suffix}@x.co`,
    });

    expect(contact?.organizationId).toBe(orgId);
    expect(contact?.name).toBe("Ada");
    expect(contact?.status).toBe("active");
  });

  test("does not leak contacts across organizations", async () => {
    const orgA = await createOrg(suffix, "orgisoA");
    const orgB = await createOrg(suffix, "orgisoB");

    await createContact({ organizationId: orgA, name: "In A" });
    await createContact({ organizationId: orgB, name: "In B" });

    const resultA = await getContactsByOrganization({ organizationId: orgA });
    const resultB = await getContactsByOrganization({ organizationId: orgB });

    expect(resultA.items).toHaveLength(1);
    expect(resultA.items[0]?.name).toBe("In A");
    expect(resultB.items).toHaveLength(1);
    expect(resultB.items[0]?.name).toBe("In B");
  });

  test("paginates and filters by status", async () => {
    const orgId = await createOrg(suffix, "orgpage");
    await createContact({ organizationId: orgId, name: "L", status: "lead" });
    await createContact({ organizationId: orgId, name: "A", status: "active" });

    const leads = await getContactsByOrganization({
      organizationId: orgId,
      status: "lead",
    });

    expect(leads.items).toHaveLength(1);
    expect(leads.items[0]?.name).toBe("L");
    expect(leads.pagination.total).toBe(1);
  });

  test("bulk insert runs inside withTransaction", async () => {
    const orgId = await createOrg(suffix, "orgbulk");

    const inserted = await withTransaction((tx) =>
      createContactsBulk({
        organizationId: orgId,
        contacts: [{ name: "One" }, { name: "Two" }],
        tx,
      }),
    );

    expect(inserted).toHaveLength(2);
  });

  test("a mid-batch failure rolls back every row", async () => {
    const orgId = await createOrg(suffix, "orgrollback");
    const existing = await createContact({
      organizationId: orgId,
      name: "Existing",
      email: `dupe_${suffix}@x.co`,
    });
    expect(existing).toBeDefined();

    // The second row reuses the first row's email within the same organization,
    // which the unique partial index rejects; the whole batch must roll back.
    await expect(
      withTransaction((tx) =>
        createContactsBulk({
          organizationId: orgId,
          contacts: [
            { name: "Fresh", email: `fresh_${suffix}@x.co` },
            { name: "Dupe", email: `dupe_${suffix}@x.co` },
          ],
          tx,
        }),
      ),
    ).rejects.toThrow();

    const after = await getContactsByOrganization({ organizationId: orgId });
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.name).toBe("Existing");
  });
});
