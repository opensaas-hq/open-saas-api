import { describe, expect, test } from "bun:test";
import {
  account,
  branches,
  contacts,
  invitation,
  member,
  organization,
  session,
  user,
  verification,
} from "../schema";

describe("@opensaas/database - Schema & Client", () => {
  describe("Better Auth Core Tables", () => {
    test("user table should have expected columns", () => {
      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.name).toBeDefined();
    });

    test("session table should have expected telemetry and device fingerprint columns", () => {
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.userId).toBeDefined();
      expect(session.ipAddress).toBeDefined();
      expect(session.userAgent).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(session.os).toBeDefined();
      expect(session.country).toBeDefined();
    });

    test("account table should have expected columns", () => {
      expect(account).toBeDefined();
      expect(account.id).toBeDefined();
      expect(account.userId).toBeDefined();
      expect(account.providerId).toBeDefined();
    });

    test("verification table should have expected columns", () => {
      expect(verification).toBeDefined();
      expect(verification.identifier).toBeDefined();
      expect(verification.value).toBeDefined();
    });
  });

  describe("Better Auth Organization & Member Tables", () => {
    test("organization table should have expected columns", () => {
      expect(organization).toBeDefined();
      expect(organization.id).toBeDefined();
      expect(organization.name).toBeDefined();
      expect(organization.slug).toBeDefined();
    });

    test("member table should have expected columns and foreign keys", () => {
      expect(member).toBeDefined();
      expect(member.id).toBeDefined();
      expect(member.organizationId).toBeDefined();
      expect(member.userId).toBeDefined();
      expect(member.role).toBeDefined();
    });

    test("invitation table should have expected columns", () => {
      expect(invitation).toBeDefined();
      expect(invitation.organizationId).toBeDefined();
      expect(invitation.email).toBeDefined();
      expect(invitation.status).toBeDefined();
    });
  });

  describe("Business Logic Entities (CRM & Branches)", () => {
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
