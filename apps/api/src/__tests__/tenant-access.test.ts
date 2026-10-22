import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createBranch,
  db,
  removeMember,
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
 * The tenant boundary of the HTTP surface (§4.3).
 *
 * These are the negative tests the project never had: a session pointing at
 * an organization the user does not belong to, a branch of another tenant, and
 * a role that is not allowed to perform an operation. Each one must be refused
 * by the HTTP layer, before any tenant-scoped row is read or written.
 */
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

/** Unique slug per test, so the suites never collide on the unique column. */
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The cache is disabled for these tests on purpose: they change a role
 * directly in the database, and the point of the assertions is the
 * authorization decision, not the caching. The cache has its own suite
 * (`membership-cache.test.ts`).
 */
const createAppWithoutCache = () =>
  createTestApp({ MEMBERSHIP_CACHE_TTL_S: 0 });

describeIfDb("Apps/API - Tenant isolation and RBAC (§4.3)", () => {
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

  test("a session whose active organization the user does not belong to is refused with 403", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "notmember@example.com",
      password: "password123",
      name: "Not Member",
      slug: uniqueSlug("notmember"),
    });

    // The membership is gone: the session still points at the organization, but
    // the user no longer belongs to it. That is the escalation the tenant
    // middleware has to refuse.
    await removeMember({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
    });

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: jsonHeaders(tenant.cookie),
      }),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("NOT_A_MEMBER");
  });

  test("a branch of another organization is refused on list and on create", async () => {
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

    const foreignBranch = await createBranch({
      organizationId: other.organizationId,
      name: "Foreign Branch",
    });

    // Listing with the foreign branch in the header is refused.
    const list = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: {
          ...jsonHeaders(tenant.cookie),
          "x-branch-id": foreignBranch?.id ?? "",
        },
      }),
    );
    expect(list.status).toBe(404);

    // The same branch in the query string is refused too.
    const listByQuery = await app.fetch(
      new Request(
        `${APP_ORIGIN}/api/v1/contacts?branchId=${foreignBranch?.id ?? ""}`,
        { headers: jsonHeaders(tenant.cookie) },
      ),
    );
    expect(listByQuery.status).toBe(404);

    // And so is a contact created against it.
    const create = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        method: "POST",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({
          name: "Cross Tenant",
          branchId: foreignBranch?.id,
        }),
      }),
    );
    expect(create.status).toBe(404);

    // The contact was not created.
    const contacts = await db.select().from(schema.contacts);
    expect(contacts).toHaveLength(0);
  });

  test("a branch of the own organization is accepted", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "same-org@example.com",
      password: "password123",
      name: "Same Org",
      slug: uniqueSlug("same-org"),
    });

    const branch = await createBranch({
      organizationId: tenant.organizationId,
      name: "Own Branch",
    });

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        method: "POST",
        headers: jsonHeaders(tenant.cookie),
        body: JSON.stringify({
          name: "Own Contact",
          branchId: branch?.id,
        }),
      }),
    );

    expect(res.status).toBe(201);
  });

  test("a member is denied the bulk import and an admin is allowed", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "rbac@example.com",
      password: "password123",
      name: "Rbac User",
      slug: uniqueSlug("rbac"),
    });

    const bulk = async () =>
      await app.fetch(
        new Request(`${APP_ORIGIN}/api/v1/contacts/bulk`, {
          method: "POST",
          headers: jsonHeaders(tenant.cookie),
          body: JSON.stringify({
            contacts: [{ name: "Bulk Contact" }],
          }),
        }),
      );

    // The creator is the owner: the import is allowed.
    expect((await bulk()).status).toBe(201);

    // Downgraded to the plain member role: the import is refused.
    await updateMemberRole({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      role: "member",
    });
    const denied = await bulk();
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { error?: { code?: string } };
    expect(deniedBody.error?.code).toBe("FORBIDDEN");

    // An admin may import again.
    await updateMemberRole({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      role: "admin",
    });
    expect((await bulk()).status).toBe(201);
  });

  test("a malformed branch id is refused with 422", async () => {
    const { app } = createAppWithoutCache();
    const tenant = await createTenant(app, {
      email: "badbranch@example.com",
      password: "password123",
      name: "Bad Branch",
      slug: uniqueSlug("badbranch"),
    });

    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: {
          ...jsonHeaders(tenant.cookie),
          "x-branch-id": "not-a-uuid",
        },
      }),
    );

    expect(res.status).toBe(422);
  });
});
