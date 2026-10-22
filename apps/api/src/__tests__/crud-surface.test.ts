import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  db,
  schema,
  updateMemberRole,
  withRawTransaction,
} from "@opensaas/database";
import {
  APP_ORIGIN,
  createTenant,
  createTestApp,
  hasTestDatabase,
  jsonHeaders,
} from "./support/app";

/**
 * The CRUD surface of the CRM (§4.9).
 *
 * The schema and the API surface used to disagree: the branches had tables
 * and services but no route, and a contact could only be listed and created.
 * These tests prove that every verb of the surface exists, stays inside its
 * tenant and respects the permission matrix.
 */
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

/** Unique slug per test, so the suites never collide on the unique column. */
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The cache is disabled for these tests on purpose: they change a role
 * directly in the database, and the point of the assertions is the
 * authorization decision, not the caching.
 */
const createAppWithoutCache = () =>
  createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });

/** Create a contact through the API and return its id. */
const createContact = async (
  app: ReturnType<typeof createTestApp>["app"],
  cookie: string,
  name: string,
): Promise<string> => {
  const res = await app.fetch(
    new Request(`${APP_ORIGIN}/api/v1/contacts`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ name }),
    }),
  );

  expect(res.status).toBe(201);

  const body = (await res.json()) as { data?: { id?: string } };

  if (!body.data?.id) {
    throw new Error("the contact was created without an id");
  }

  return body.data.id;
};

describeIfDb("Apps/API - CRUD surface (§4.9)", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        `TRUNCATE TABLE registration_code, waitlist_entry, "member", "organization",
         "account", "session", "verification", "user", branches, contacts
         RESTART IDENTITY CASCADE`,
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("GET /api/v1/contacts/:id returns the contact of the tenant", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "read@example.com",
      password: "password123",
      name: "Read User",
      slug: uniqueSlug("read"),
    });

    const id = await createContact(app, tenant.cookie, "Readable");

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts/${id}`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { id?: string; name?: string };
    };
    expect(body.data?.id).toBe(id);
    expect(body.data?.name).toBe("Readable");
  });

  test("GET /api/v1/contacts/:id of another tenant is reported as missing", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "owner-a@example.com",
      password: "password123",
      name: "Owner A",
      slug: uniqueSlug("owner-a"),
    });
    const other = await createTenant(app, {
      email: "owner-b@example.com",
      password: "password123",
      name: "Owner B",
      slug: uniqueSlug("owner-b"),
    });

    const id = await createContact(app, other.cookie, "Foreign");

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts/${id}`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    // The other tenant's contact does not even exist for this caller: the
    // response never confirms that the id is in use somewhere else.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  test("PATCH /api/v1/contacts/:id updates the contact", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "patch@example.com",
      password: "password123",
      name: "Patch User",
      slug: uniqueSlug("patch"),
    });

    const id = await createContact(app, tenant.cookie, "Before");

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts/${id}`, {
        method: "PATCH",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "After" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { name?: string } };
    expect(body.data?.name).toBe("After");

    // The change is persisted, not only echoed.
    const rows = await db.select().from(schema.contacts);
    expect(rows.find((row) => row.id === id)?.name).toBe("After");
  });

  test("PATCH /api/v1/contacts/:id of another tenant changes nothing", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "cross-a@example.com",
      password: "password123",
      name: "Cross A",
      slug: uniqueSlug("cross-a"),
    });
    const other = await createTenant(app, {
      email: "cross-b@example.com",
      password: "password123",
      name: "Cross B",
      slug: uniqueSlug("cross-b"),
    });

    const id = await createContact(app, other.cookie, "Untouched");

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts/${id}`, {
        method: "PATCH",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "Hijacked" }),
      }),
    );

    expect(res.status).toBe(404);

    const rows = await db.select().from(schema.contacts);
    expect(rows.find((row) => row.id === id)?.name).toBe("Untouched");
  });

  test("DELETE /api/v1/contacts/:id is denied to a member and allowed to an owner", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "delete@example.com",
      password: "password123",
      name: "Delete User",
      slug: uniqueSlug("delete"),
    });

    const id = await createContact(app, tenant.cookie, "Deletable");

    const remove = async () =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts/${id}`, {
          method: "DELETE",
          headers: jsonHeaders(tenant.cookie),
        }),
      );

    // Downgraded to the plain member role: the deletion is refused.
    await updateMemberRole({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      role: "member",
    });

    const denied = await remove();
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { error?: { code?: string } };
    expect(deniedBody.error?.code).toBe("FORBIDDEN");

    // The contact is still there.
    const rows = await db.select().from(schema.contacts);
    expect(rows.filter((row) => row.id === id)).toHaveLength(1);

    // Back to the owner role: the deletion succeeds.
    await updateMemberRole({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      role: "owner",
    });

    const allowed = await remove();
    expect(allowed.status).toBe(200);

    const after = await db.select().from(schema.contacts);
    expect(after.filter((row) => row.id === id)).toHaveLength(0);
  });

  test("GET /api/v1/contacts answers a matching If-None-Match with a 304 and no body", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "etag@example.com",
      password: "password123",
      name: "Etag User",
      slug: uniqueSlug("etag"),
    });

    await createContact(app, tenant.cookie, "Cached");

    const first = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    const second = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: { ...jsonHeaders(tenant.cookie), "if-none-match": etag ?? "" },
      }),
    );

    // The body is not sent again: the client already holds it.
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("the branches surface exposes list, create, update and delete", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "branch@example.com",
      password: "password123",
      name: "Branch User",
      slug: uniqueSlug("branch"),
    });

    const create = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        method: "POST",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "Main Street" }),
      }),
    );

    expect(create.status).toBe(201);
    const created = (await create.json()) as { data?: { id?: string } };
    const branchId = created.data?.id ?? "";
    expect(branchId).not.toBe("");

    const list = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    expect(list.status).toBe(200);
    const listed = (await list.json()) as { data?: { id?: string }[] };
    expect(listed.data?.map((branch) => branch.id)).toContain(branchId);

    const update = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches/${branchId}`, {
        method: "PATCH",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "Second Street" }),
      }),
    );

    expect(update.status).toBe(200);
    const updated = (await update.json()) as { data?: { name?: string } };
    expect(updated.data?.name).toBe("Second Street");

    const remove = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches/${branchId}`, {
        method: "DELETE",
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    expect(remove.status).toBe(200);

    const rows = await db.select().from(schema.branches);
    expect(rows.filter((row) => row.id === branchId)).toHaveLength(0);
  });

  test("a member cannot manage the branches", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "branch-rbac@example.com",
      password: "password123",
      name: "Branch Rbac",
      slug: uniqueSlug("branch-rbac"),
    });

    await updateMemberRole({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      role: "member",
    });

    const create = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        method: "POST",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "Forbidden" }),
      }),
    );

    expect(create.status).toBe(403);

    // The listing stays available to a member.
    const list = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );
    expect(list.status).toBe(200);
  });

  test("the branches of another tenant are not reachable", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "branch-a@example.com",
      password: "password123",
      name: "Branch A",
      slug: uniqueSlug("branch-a"),
    });
    const other = await createTenant(app, {
      email: "branch-b@example.com",
      password: "password123",
      name: "Branch B",
      slug: uniqueSlug("branch-b"),
    });

    const create = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        method: "POST",
        headers: jsonHeaders(other.cookie),
        body: JSON.stringify({ name: "Foreign" }),
      }),
    );

    const created = (await create.json()) as { data?: { id?: string } };
    const branchId = created.data?.id ?? "";

    const list = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    const listed = (await list.json()) as { data?: { id?: string }[] };
    expect(listed.data?.map((branch) => branch.id)).not.toContain(branchId);

    const update = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches/${branchId}`, {
        method: "PATCH",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({ name: "Hijacked" }),
      }),
    );

    expect(update.status).toBe(404);

    const remove = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches/${branchId}`, {
        method: "DELETE",
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    expect(remove.status).toBe(404);

    const rows = await db.select().from(schema.branches);
    expect(rows.filter((row) => row.id === branchId)).toHaveLength(1);
  });
});
