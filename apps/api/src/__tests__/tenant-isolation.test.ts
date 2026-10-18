import { describe, expect, test } from "bun:test";
import {
  createContact,
  createOrganization,
  getContactsByOrganization,
} from "@opensaas/database";

describe("Multi-Tenant Isolation Verification (Real DB)", () => {
  test("getContactsByOrganization must strictly filter by organizationId without cross-leakage", async () => {
    // Generate unique organization IDs for this test run to avoid collision
    const suffix = Date.now().toString();
    const orgIdA = `org_test_aaa_${suffix}`;
    const orgIdB = `org_test_bbb_${suffix}`;

    // Create parent organizations first to satisfy foreign key constraints
    await createOrganization({
      id: orgIdA,
      name: "Org A",
      slug: `org-a-${suffix}`,
    });

    await createOrganization({
      id: orgIdB,
      name: "Org B",
      slug: `org-b-${suffix}`,
    });

    // Create contacts for organization A using repository helper
    await createContact({
      organizationId: orgIdA,
      name: "Contact in Org A",
      email: `contactA_${suffix}@orga.com`,
      status: "active",
      optIn: true,
    });

    // Create contacts for organization B using repository helper
    await createContact({
      organizationId: orgIdB,
      name: "Contact in Org B",
      email: `contactB_${suffix}@orgb.com`,
      status: "active",
      optIn: true,
    });

    // Query contacts strictly by organization A
    const resultOrgA = await getContactsByOrganization({
      organizationId: orgIdA,
    });

    // Query contacts strictly by organization B
    const resultOrgB = await getContactsByOrganization({
      organizationId: orgIdB,
    });

    // Strict assertions enforcing multi-tenant isolation
    expect(resultOrgA.items.length).toBe(1);
    for (const contact of resultOrgA.items) {
      expect(contact.organizationId).toBe(orgIdA);
      expect(contact.organizationId).not.toBe(orgIdB);
      expect(contact.name).toBe("Contact in Org A");
    }

    expect(resultOrgB.items.length).toBe(1);
    for (const contact of resultOrgB.items) {
      expect(contact.organizationId).toBe(orgIdB);
      expect(contact.organizationId).not.toBe(orgIdA);
      expect(contact.name).toBe("Contact in Org B");
    }
  });
});
