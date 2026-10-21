import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { initConfig } from "@opensaas/core";
import { schema, withRawTransaction } from "@opensaas/database";
import app from "../index";
import { registerSchema } from "../routes/auth";

// The route reads the registration mode from validated config, so tests inject
// it through `initConfig` instead of mutating `process.env` between cases. The
// database URL comes from the real test environment (`.env.test`), because
// registration now persists rows (§3.1).
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3015",
};

const hasDatabase =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

const describeIfDb = hasDatabase ? describe : describe.skip;

const register = (body: Record<string, unknown>) =>
  app.fetch(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describeIfDb(
  "Apps/API - Auth Registration Integration Routes (/api/auth/register)",
  () => {
    beforeEach(async () => {
      initConfig({ ...baseEnv, REGISTRATION_MODE: "public" });
      await withRawTransaction(async (tx) => {
        await tx.execute(
          `TRUNCATE TABLE registration_code, waitlist_entry, "member",
           "organization", "account", "session", "verification", "user"
           RESTART IDENTITY CASCADE`,
        );
      });
    });

    afterAll(async () => {
      const { close } = await import("@opensaas/database");
      await close();
    });

    test("registers successfully and persists the rows (§3.1 AC5)", async () => {
      const res = await register({
        email: "johndoe@example.com",
        password: "securepassword123",
        name: "John Doe",
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.email).toBe("johndoe@example.com");
      expect(data.data.status).toBe("active");

      const { db } = await import("@opensaas/database");
      const users = await db.select().from(schema.user);
      const accounts = await db.select().from(schema.account);
      const orgs = await db.select().from(schema.organization);
      const members = await db.select().from(schema.member);

      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe("johndoe@example.com");
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.password).not.toBe("securepassword123");
      expect(orgs).toHaveLength(1);
      expect(members).toHaveLength(1);
      expect(members[0]?.role).toBe("owner");
    });

    test("rejects a disposable email with 422", async () => {
      const res = await register({
        email: "user@mailinator.com",
        password: "password123",
        name: "Burner User",
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    test("an invalid payload returns the 422 envelope with field details", async () => {
      const res = await register({
        email: "bad-email",
        password: "short",
        name: "",
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.fieldErrors).toHaveProperty("email");
    });

    test("waiting_list mode persists a waitlist row", async () => {
      initConfig({ ...baseEnv, REGISTRATION_MODE: "waiting_list" });

      const res = await register({
        email: "waitlist.user@example.com",
        password: "password123",
        name: "Waitlist User",
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.status).toBe("waitlist");

      const { db, getWaitlistEntryByEmail } = await import(
        "@opensaas/database"
      );
      const row = await getWaitlistEntryByEmail({
        email: "waitlist.user@example.com",
      });
      expect(row?.status).toBe("pending");
      expect(await db.select().from(schema.user)).toHaveLength(1);
    });

    test("a duplicate email returns a 409 with a stable code (§3.1 AC4)", async () => {
      await register({
        email: "dup@example.com",
        password: "password123",
        name: "First",
      });
      const res = await register({
        email: "dup@example.com",
        password: "password123",
        name: "Second",
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    });

    test("rejects invite_code mode if no code is provided", async () => {
      initConfig({ ...baseEnv, REGISTRATION_MODE: "invite_code" });

      const res = await register({
        email: "invited.user@example.com",
        password: "password123",
        name: "Invited User",
      });

      expect(res.status).toBe(422);
    });

    // §3.2 AC1: no field in the register DTO can assert payment.
    test("the register DTO has no payment field a client could assert", () => {
      const parsed = registerSchema.safeParse({
        email: "user@example.com",
        password: "password123",
        name: "User",
        hasPaid: true,
        paid: true,
        paymentReference: "anything",
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty("hasPaid");
        expect(parsed.data).not.toHaveProperty("paid");
        expect(parsed.data).not.toHaveProperty("paymentReference");
      }
    });
  },
);
