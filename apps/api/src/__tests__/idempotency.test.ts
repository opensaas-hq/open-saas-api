import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db, schema, withRawTransaction } from "@opensaas/database";
import {
  APP_ORIGIN,
  createTenant,
  createTestApp,
  hasTestDatabase,
  jsonHeaders,
} from "./support/app";

/**
 * The replay rules of the write endpoints (§4.9).
 *
 * A client that loses the response of a write retries it. Without an
 * idempotency key the retry writes a second row; with a key the retry replays
 * the original response. These tests prove both halves: the protection works,
 * and it is the key that provides it.
 */
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

/** Unique slug per test, so the suites never collide on the unique column. */
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createAppWithoutCache = () =>
  createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });

describeIfDb("Apps/API - Idempotency keys (§4.9)", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        `TRUNCATE TABLE idempotency_keys, registration_code, waitlist_entry,
         "member", "organization", "account", "session", "verification", "user",
         branches, contacts RESTART IDENTITY CASCADE`,
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("a replay of POST /api/v1/contacts returns the original response and writes no second contact", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "idem@example.com",
      password: "password123",
      name: "Idem User",
      slug: uniqueSlug("idem"),
    });

    const post = async () =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts`, {
          method: "POST",
          headers: {
            ...jsonHeaders(tenant.cookie),
            "idempotency-key": "key-1",
          },
          body: JSON.stringify({ name: "Idempotent" }),
        }),
      );

    const first = await post();
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data?: { id?: string } };

    const second = await post();
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");

    const secondBody = (await second.json()) as { data?: { id?: string } };

    // The same contact is returned, not a new one.
    expect(secondBody.data?.id).toBe(firstBody.data?.id);

    const rows = await db.select().from(schema.contacts);
    expect(rows).toHaveLength(1);
  });

  test("two concurrent requests with the same key write a single contact", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "idem-race@example.com",
      password: "password123",
      name: "Idem Race",
      slug: uniqueSlug("idem-race"),
    });

    const post = async () =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts`, {
          method: "POST",
          headers: {
            ...jsonHeaders(tenant.cookie),
            "idempotency-key": "key-race",
          },
          body: JSON.stringify({ name: "Raced" }),
        }),
      );

    const [first, second] = await Promise.all([post(), post()]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstBody = (await first.json()) as { data?: { id?: string } };
    const secondBody = (await second.json()) as { data?: { id?: string } };

    // Both callers see the same contact: the loser of the claim replays the
    // response of the winner instead of writing a second row.
    expect(firstBody.data?.id).toBe(secondBody.data?.id);

    const rows = await db.select().from(schema.contacts);
    expect(rows).toHaveLength(1);
  });

  test("the same key with a different payload is refused with a conflict", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "idem-conflict@example.com",
      password: "password123",
      name: "Idem Conflict",
      slug: uniqueSlug("idem-conflict"),
    });

    const post = async (name: string) =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts`, {
          method: "POST",
          headers: {
            ...jsonHeaders(tenant.cookie),
            "idempotency-key": "key-conflict",
          },
          body: JSON.stringify({ name }),
        }),
      );

    expect((await post("First")).status).toBe(201);

    const conflict = await post("Second");
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("CONFLICT");

    const rows = await db.select().from(schema.contacts);
    expect(rows).toHaveLength(1);
  });

  test("without a key the same request twice writes two contacts", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "nokey@example.com",
      password: "password123",
      name: "No Key",
      slug: uniqueSlug("nokey"),
    });

    const post = async () =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts`, {
          method: "POST",
          headers: jsonHeaders(tenant.cookie),
          body: JSON.stringify({ name: "Twice" }),
        }),
      );

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);

    const rows = await db.select().from(schema.contacts);
    expect(rows).toHaveLength(2);
  });

  test("the keys of two tenants never collide", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "idem-a@example.com",
      password: "password123",
      name: "Idem A",
      slug: uniqueSlug("idem-a"),
    });
    const other = await createTenant(app, {
      email: "idem-b@example.com",
      password: "password123",
      name: "Idem B",
      slug: uniqueSlug("idem-b"),
    });

    const post = async (cookie: string, name: string) =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts`, {
          method: "POST",
          headers: { ...jsonHeaders(cookie), "idempotency-key": "shared-key" },
          body: JSON.stringify({ name }),
        }),
      );

    expect((await post(tenant.cookie, "First")).status).toBe(201);
    expect((await post(other.cookie, "Second")).status).toBe(201);

    // Each tenant wrote its own contact: the key is scoped, not global.
    const rows = await db.select().from(schema.contacts);
    expect(rows).toHaveLength(2);
  });

  test("a replayed registration does not create a second user", async () => {
    const { app } = createAppWithoutCache();

    const register = async () =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/registration`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "registration-key",
          },
          body: JSON.stringify({
            email: "replay@example.com",
            password: "password123",
            name: "Replay User",
          }),
        }),
      );

    const first = await register();
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data?: { email?: string } };

    const second = await register();
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");

    const secondBody = (await second.json()) as { data?: { email?: string } };
    expect(secondBody.data?.email).toBe(firstBody.data?.email);

    const users = await db.select().from(schema.user);
    expect(
      users.filter((user) => user.email === "replay@example.com"),
    ).toHaveLength(1);
  });
});
