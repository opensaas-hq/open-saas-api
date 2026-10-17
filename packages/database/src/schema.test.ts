import { describe, expect, test } from "bun:test";
import { branches, contacts, organizations } from "./schema";

describe("@opensaas/database - Schema & Client", () => {
  describe("Tables structure", () => {
    test("organizations table should have expected columns", () => {
      expect(organizations).toBeDefined();
      expect(organizations.id).toBeDefined();
      expect(organizations.name).toBeDefined();
      expect(organizations.slug).toBeDefined();
      expect(organizations.createdAt).toBeDefined();
    });

    test("branches table should have expected columns and foreign key reference", () => {
      expect(branches).toBeDefined();
      expect(branches.id).toBeDefined();
      expect(branches.organizationId).toBeDefined();
      expect(branches.name).toBeDefined();
    });

    test("contacts table should have expected columns and optIn property", () => {
      expect(contacts).toBeDefined();
      expect(contacts.id).toBeDefined();
      expect(contacts.organizationId).toBeDefined();
      expect(contacts.name).toBeDefined();
      expect(contacts.optIn).toBeDefined();
      expect(contacts.metadata).toBeDefined();
    });
  });
});
