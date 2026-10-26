import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createRegistrationCode,
  getRegistrationCode,
  schema,
  withRawTransaction,
} from "@opensaas/database";
import type { Hono } from "hono";
import type { AppEnv } from "../types";
import { createTestApp, hasTestDatabase, jsonHeaders } from "./support/app";

// Two concurrent registrations compete for a single-use invite code: exactly
// one must win (201) and the other must be refused with a typed 409/422 — never
// a 500, and never two consumed uses. This exercises the server-side guarantee
// end-to-end through the route (§3.2 AC2, §4.4), beyond the repository-level
// race covered in packages/database.
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
  "Apps/API - Registration concurrency on a single-use invite code (§3.2)",
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

    test("exactly one of two parallel registrations consumes the last use", async () => {
      const { app } = createTestApp({ REGISTRATION_MODE: "invite_code" });
      await createRegistrationCode({ code: "RACE-CODE", maxUses: 1 });

      const [first, second] = await Promise.all([
        register(app, {
          email: "racer.one@example.com",
          password: "password123",
          name: "Racer One",
          inviteCode: "RACE-CODE",
        }),
        register(app, {
          email: "racer.two@example.com",
          password: "password123",
          name: "Racer Two",
          inviteCode: "RACE-CODE",
        }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses[0]).toBe(201);
      // The loser is refused with a typed domain error, never a 500.
      expect([409, 422]).toContain(statuses[1]);

      // Exactly one user/account/organization was persisted.
      const users = await import("@opensaas/database").then(({ db }) =>
        db.select().from(schema.user),
      );
      expect(users).toHaveLength(1);

      const code = await getRegistrationCode({ code: "RACE-CODE" });
      expect(code?.status).toBe("consumed");
      expect(code?.useCount).toBe(1);
    });
  },
);
