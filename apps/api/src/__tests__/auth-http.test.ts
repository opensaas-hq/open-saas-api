import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { withRawTransaction } from "@opensaas/database";
import {
  APP_ORIGIN,
  createOrganization,
  createTestApp,
  hasTestDatabase,
  jsonHeaders,
  signIn,
  signUp,
} from "./support/app";

/**
 * The mounted Better Auth surface (§4.1).
 *
 * These are the tests that close the biggest gap of the project: before this
 * item the framework instance was never mounted, so `auth.api.getSession()`
 * always resolved to `null` over HTTP and every tenant-scoped route answered
 * 401 forever.
 */
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

const resetTables = async () => {
  await withRawTransaction(async (tx) => {
    await tx.execute(
      `TRUNCATE TABLE registration_code, waitlist_entry, "member", "organization",
       "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
    );
  });
};

/** Unique slug per test, so parallel suites never collide. */
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describeIfDb("Apps/API - Mounted Better Auth surface (§4.1)", () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("POST /api/auth/sign-up/email creates the account and sets a session cookie", async () => {
    const { app } = createTestApp();

    const { res, cookie } = await signUp(app, {
      email: "signup@example.com",
      password: "password123",
      name: "Sign Up",
    });

    expect(res.status).toBe(200);
    expect(cookie).toContain("session_token");

    const body = (await res.json()) as { user?: { email?: string } };
    expect(body.user?.email).toBe("signup@example.com");
  });

  test("POST /api/auth/sign-in/email accepts valid credentials and refuses wrong ones", async () => {
    const { app } = createTestApp();
    const user = {
      email: "signin@example.com",
      password: "password123",
      name: "Sign In",
    };
    await signUp(app, user);

    const ok = await signIn(app, user);
    expect(ok.res.status).toBe(200);
    expect(ok.cookie).toContain("session_token");

    const bad = await signIn(app, { ...user, password: "wrongpassword" });
    expect(bad.res.status).toBe(401);
  });

  test("GET /api/auth/get-session returns the session for a valid cookie", async () => {
    const { app } = createTestApp();
    const { cookie } = await signUp(app, {
      email: "session@example.com",
      password: "password123",
      name: "Session",
    });

    const withCookie = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, {
        headers: jsonHeaders(cookie),
      }),
    );
    expect(withCookie.status).toBe(200);
    const body = (await withCookie.json()) as {
      session?: { userId?: string };
      user?: { email?: string };
    };
    expect(body.user?.email).toBe("session@example.com");
    expect(body.session?.userId).toBeTruthy();

    const withoutCookie = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/get-session`),
    );
    expect(withoutCookie.status).toBe(200);
    expect(await withoutCookie.json()).toBeNull();
  });

  test("POST /api/auth/sign-out invalidates the session", async () => {
    const { app } = createTestApp();
    const { cookie } = await signUp(app, {
      email: "signout@example.com",
      password: "password123",
      name: "Sign Out",
    });

    const out = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: jsonHeaders(cookie),
      }),
    );
    expect(out.status).toBe(200);

    // The revoked session no longer resolves to a user.
    const after = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/get-session`, {
        headers: jsonHeaders(cookie),
      }),
    );
    const body = (await after.json()) as { user?: { email?: string } } | null;
    expect(body?.user?.email).toBeUndefined();
  });

  test("the organization endpoints of the plugin are reachable", async () => {
    const { app } = createTestApp();
    const { cookie } = await signUp(app, {
      email: "org@example.com",
      password: "password123",
      name: "Org Owner",
    });

    const created = await createOrganization(app, cookie, {
      name: "Acme",
      slug: uniqueSlug("acme"),
    });
    expect(created.status).toBe(200);
    const org = (await created.json()) as { id?: string; members?: unknown[] };
    expect(org.id).toBeTruthy();
    expect(org.members).toHaveLength(1);

    const list = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/organization/list`, {
        headers: jsonHeaders(cookie),
      }),
    );
    expect(list.status).toBe(200);
    const organizations = (await list.json()) as unknown[];
    expect(organizations).toHaveLength(1);
  });

  test("a session obtained over HTTP calls a tenant-scoped route end to end (§4.1 AC2)", async () => {
    const { app } = createTestApp();
    const { cookie } = await signUp(app, {
      email: "tenant@example.com",
      password: "password123",
      name: "Tenant User",
    });

    const created = await createOrganization(app, cookie, {
      name: "Tenant Org",
      slug: uniqueSlug("tenant"),
    });
    expect(created.status).toBe(200);

    // The organization plugin set the active organization on the session, so
    // the tenant middleware resolves a tenant and the route answers 200.
    const list = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: jsonHeaders(cookie),
      }),
    );

    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      success: boolean;
      data?: unknown[];
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  test("a tenant-scoped route without a session is still refused with 401", async () => {
    const { app } = createTestApp();

    const res = await app.fetch(new Request(`${APP_ORIGIN}/api/v1/contacts`));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  test("the custom registration endpoint coexists with the framework surface (no shadowing)", async () => {
    const { app } = createTestApp();

    // The framework owns /api/auth/* ...
    const signUpRes = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "both@example.com",
          password: "password123",
          name: "Both",
        }),
      }),
    );
    expect(signUpRes.status).toBe(200);

    // ... and the project-owned registration lives outside it (§4.1 path
    // decision), answering on its own path.
    const registerRes = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/registration`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: "custom@example.com",
          password: "password123",
          name: "Custom",
        }),
      }),
    );
    expect(registerRes.status).toBe(201);
    const body = (await registerRes.json()) as {
      data?: { email?: string; status?: string };
    };
    expect(body.data?.email).toBe("custom@example.com");
    expect(body.data?.status).toBe("active");
  });
});
