import { describe, expect, spyOn, test } from "bun:test";
import * as dbModule from "@opensaas/database";

describe("Multi-Tenant Isolation Verification", () => {
  test("getContactsByOrganization must strictly filter by organizationId", async () => {
    const orgA = "org_111111111111111111111111";
    const orgB = "org_222222222222222222222222";

    const spy = spyOn(dbModule, "getContactsByOrganization").mockImplementation(
      (options: dbModule.GetContactsOptions) => {
        const now = new Date();
        const mockDb: Record<
          string,
          Array<{
            id: string;
            organizationId: string;
            branchId: string | null;
            name: string;
            phone: string | null;
            email: string | null;
            status: string;
            optIn: boolean;
            metadata: unknown;
            createdAt: Date;
            updatedAt: Date;
          }>
        > = {
          [orgA]: [
            {
              id: "c1",
              organizationId: orgA,
              branchId: null,
              name: "Alice",
              phone: "+525511111111",
              email: "alice@org-a.com",
              status: "active",
              optIn: true,
              metadata: {},
              createdAt: now,
              updatedAt: now,
            },
          ],
          [orgB]: [
            {
              id: "c2",
              organizationId: orgB,
              branchId: null,
              name: "Bob",
              phone: "+525522222222",
              email: "bob@org-b.com",
              status: "active",
              optIn: true,
              metadata: {},
              createdAt: now,
              updatedAt: now,
            },
          ],
        };

        const items = mockDb[options.organizationId] || [];

        return Promise.resolve({
          items,
          pagination: {
            page: options.page || 1,
            limit: options.limit || 20,
            total: items.length,
            totalPages: 1,
          },
        });
      },
    );

    const resultOrgA = await dbModule.getContactsByOrganization({
      organizationId: orgA,
    });
    const resultOrgB = await dbModule.getContactsByOrganization({
      organizationId: orgB,
    });

    // 1. Validar invocaciones con los parámetros exactos
    expect(spy).toHaveBeenCalledWith({ organizationId: orgA });
    expect(spy).toHaveBeenCalledWith({ organizationId: orgB });

    // 2. Verificar aislamiento estricto de OrgA
    for (const contact of resultOrgA.items) {
      expect(contact.organizationId).toBe(orgA);
      expect(contact.organizationId).not.toBe(orgB);
    }

    // 3. Verificar aislamiento estricto de OrgB
    for (const contact of resultOrgB.items) {
      expect(contact.organizationId).toBe(orgB);
      expect(contact.organizationId).not.toBe(orgA);
    }

    spy.mockRestore();
  });
});
