import { describe, expect, test } from "bun:test";
import {
  createContact,
  createContactsBulk,
  getContactsByOrganization,
} from "../contacts";

describe("@opensaas/database - Contacts Repository", () => {
  test("should export contact management functions", () => {
    expect(createContact).toBeDefined();
    expect(getContactsByOrganization).toBeDefined();
    expect(createContactsBulk).toBeDefined();
  });
});
