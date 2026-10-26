import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { schema, withRawTransaction } from "@opensaas/database";
import type { Hono } from "hono";
import type { AppEnv } from "../types";
import { createTestApp, hasTestDatabase, jsonHeaders } from "./support/app";

// The route reads the registration mode from the validated config carried by
// the request context, so each case injects it through the app factory
// instead of mutating `process.env`. The database URL comes from the real test
// environment (`.env.test`), because registration persists rows (§3.1).
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

const register = async (app: Hono<AppEnv>, body: Record<string, unknown>) =>
  await app.fetch(
    new Request("http://localhost/api/v1/registration", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }),
  );

describeIfDb(
  "Apps/API - Auth Registration Integration Routes (/api/v1/registration)",
  () => {
    beforeEach(async () => {
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
      const { app } = createTestApp({ REGISTRATION_MODE: "public" });

      const res = await register(app, {
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
      const { app } = createTestApp({ REGISTRATION_MODE: "public" });

      const res = await register(app, {
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
      const { app } = createTestApp({ REGISTRATION_MODE: "public" });

      const res = await register(app, {
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
      const { app } = createTestApp({ REGISTRATION_MODE: "waiting_list" });

      const res = await register(app, {
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
      const { app } = createTestApp({ REGISTRATION_MODE: "public" });

      await register(app, {
        email: "dup@example.com",
        password: "password123",
        name: "First",
      });
      const res = await register(app, {
        email: "dup@example.com",
        password: "password123",
        name: "Second",
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    });

    test("a failed registration leaves zero partial rows (§4.4 AC3)", async () => {
      const { app } = createTestApp({ REGISTRATION_MODE: "public" });

      await register(app, {
        email: "partial@example.com",
        password: "password123",
        name: "First",
      });

      // The second registration fails on the very first step of the
      // transaction: nothing of it may survive, not even the organization or
      // the membership the flow creates after the sign-up.
      const res = await register(app, {
        email: "partial@example.com",
        password: "password123",
        name: "Second",
      });
      expect(res.status).toBe(409);

      const { db } = await import("@opensaas/database");

      expect(await db.select().from(schema.user)).toHaveLength(1);
      expect(await db.select().from(schema.account)).toHaveLength(1);
      expect(await db.select().from(schema.organization)).toHaveLength(1);
      expect(await db.select().from(schema.member)).toHaveLength(1);
    });

    test("rejects invite_code mode if no code is provided", async () => {
      const { app } = createTestApp({ REGISTRATION_MODE: "invite_code" });

      const res = await register(app, {
        email: "invited.user@example.com",
        password: "password123",
        name: "Invited User",
      });

      expect(res.status).toBe(422);
    });
  },
);
