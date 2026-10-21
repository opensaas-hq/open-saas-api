import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { ConflictError, createEnv } from "@opensaas/core";
import {
  createRegistrationCode,
  db,
  getWaitlistEntryByEmail,
  schema,
  withRawTransaction,
} from "@opensaas/database";
import { createStrategyRegistry } from "../registration/registry-factory";
import { registerUser } from "../registration/service";
import { createDatabaseInviteCodeValidator } from "../registration/validators/database-invite-code";

const env = createEnv({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3015",
  REGISTRATION_MODE: "public",
});

const registry = () =>
  createStrategyRegistry({
    inviteCodes: createDatabaseInviteCodeValidator(),
  });

const hasDatabase =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("@opensaas/auth - Registration flow persists rows (§3.1)", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        `TRUNCATE TABLE registration_code, waitlist_entry, "member", "organization",
         "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  const countUsers = async () => (await db.select().from(schema.user)).length;

  test("creates user, hashed account, organization and owner member", async () => {
    const result = await registerUser(
      {
        email: "owner@example.com",
        password: "securepassword123",
        name: "Owner",
      },
      { env, registry: registry() },
    );

    const users = await db.select().from(schema.user);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(result.userId);
    expect(users[0]?.email).toBe("owner@example.com");

    const accounts = await db.select().from(schema.account);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.providerId).toBe("credential");
    // The stored password is a hash, never the plaintext.
    expect(accounts[0]?.password).toBeTruthy();
    expect(accounts[0]?.password).not.toBe("securepassword123");

    const org = (await db.select().from(schema.organization)).filter(
      (o) => o.id === result.organizationId,
    );
    expect(org).toHaveLength(1);

    const members = await db.select().from(schema.member);
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(result.userId);
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.organizationId).toBe(result.organizationId);
  });

  test("duplicate email yields a 409 and leaves no partial rows", async () => {
    await registerUser(
      { email: "dup@example.com", password: "password123", name: "First" },
      { env, registry: registry() },
    );

    await expect(
      registerUser(
        { email: "dup@example.com", password: "password123", name: "Second" },
        { env, registry: registry() },
      ),
    ).rejects.toThrow(ConflictError);

    expect(await countUsers()).toBe(1);
  });

  test("waiting_list mode persists a queryable waitlist row", async () => {
    const waitlistEnv = { ...env, REGISTRATION_MODE: "waiting_list" as const };

    const result = await registerUser(
      {
        email: "waiter@example.com",
        password: "password123",
        name: "Waiter",
      },
      { env: waitlistEnv, registry: registry() },
    );

    expect(result.status).toBe("waitlist");
    const row = await getWaitlistEntryByEmail({ email: "waiter@example.com" });
    expect(row?.status).toBe("pending");
    expect(row?.userId).toBe(result.userId);
  });

  test("invite_code mode consumes a valid code exactly once", async () => {
    await createRegistrationCode({ code: "GOOD-CODE" });
    const inviteEnv = { ...env, REGISTRATION_MODE: "invite_code" as const };

    const result = await registerUser(
      {
        email: "invited@example.com",
        password: "password123",
        name: "Invited",
        inviteCode: "GOOD-CODE",
      },
      { env: inviteEnv, registry: registry() },
    );

    expect(result.status).toBe("active");
    const [code] = (await db.select().from(schema.registrationCode)).filter(
      (c) => c.code === "GOOD-CODE",
    );
    expect(code?.status).toBe("consumed");
    expect(code?.useCount).toBe(1);
  });

  test("an invalid invite code leaves zero rows (validation precedes writes)", async () => {
    const inviteEnv = { ...env, REGISTRATION_MODE: "invite_code" as const };

    await expect(
      registerUser(
        {
          email: "blocked@example.com",
          password: "password123",
          name: "Blocked",
          inviteCode: "NOPE",
        },
        { env: inviteEnv, registry: registry() },
      ),
    ).rejects.toThrow();

    expect(await countUsers()).toBe(0);
    expect(await db.select().from(schema.organization)).toHaveLength(0);
  });
});
