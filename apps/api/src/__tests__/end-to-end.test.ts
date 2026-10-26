import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { withRawTransaction } from "@opensaas/database";
import {
  APP_ORIGIN,
  cookieHeader,
  createTestApp,
  hasTestDatabase,
  jsonHeaders,
  signIn,
} from "./support/app";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;

const uniqueEmail = () =>
  `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

describeIfDb("Apps/API - End-to-end demo flow", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        `TRUNCATE TABLE idempotency_keys, registration_code, waitlist_entry,
         "member", "organization", "account", "session", "verification", "user",
         branches, contacts
         RESTART IDENTITY CASCADE`,
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("registers, signs in, activates the tenant, creates CRM data, and queries GraphQL", async () => {
    const { app } = createTestApp({ REGISTRATION_MODE: "public" });
    const email = uniqueEmail();
    const password = "Password123!";

    const registration = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/registration`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email,
          password,
          name: "Demo User",
        }),
      }),
    );

    expect(registration.status).toBe(201);
    const registered = await json<{ data: { status: string } }>(registration);
    expect(registered.data.status).toBe("active");

    const signedIn = await signIn(app, { email, password });
    expect(signedIn.res.status).toBe(200);
    expect(signedIn.cookie).not.toBe("");

    const organizations = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/organization/list`, {
        headers: jsonHeaders(signedIn.cookie),
      }),
    );

    expect(organizations.status).toBe(200);
    const organizationList = await json<Array<{ id: string }>>(organizations);
    expect(organizationList.length).toBeGreaterThan(0);

    const organizationId = organizationList[0]?.id;
    expect(organizationId).toBeTruthy();

    const activated = await app.fetch(
      new Request(`${APP_ORIGIN}/api/auth/organization/set-active`, {
        method: "POST",
        headers: jsonHeaders(signedIn.cookie),
        body: JSON.stringify({ organizationId }),
      }),
    );

    expect(activated.status).toBe(200);
    const cookie = cookieHeader(activated) || signedIn.cookie;

    const branch = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/branches`, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ name: "Main branch" }),
      }),
    );

    expect(branch.status).toBe(201);
    const branchBody = await json<{ data: { id: string } }>(branch);

    const contact = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@example.com",
          branchId: branchBody.data.id,
        }),
      }),
    );

    expect(contact.status).toBe(201);
    const contactBody = await json<{ data: { id: string } }>(contact);

    const contactList = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: jsonHeaders(cookie),
      }),
    );

    expect(contactList.status).toBe(200);
    const contactListBody = await json<{
      data: Array<{ id: string; name: string }>;
    }>(contactList);
    expect(
      contactListBody.data.some((item) => item.id === contactBody.data.id),
    ).toBe(true);

    const graphql = await app.fetch(
      new Request(`${APP_ORIGIN}/graphql`, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({
          query: `
            query DemoContacts {
              contacts {
                items { id name }
              }
            }
          `,
        }),
      }),
    );

    expect(graphql.status).toBe(200);
    const graphqlBody = await json<{
      data?: { contacts: { items: Array<{ id: string; name: string }> } };
      errors?: unknown[];
    }>(graphql);
    expect(graphqlBody.errors).toBeUndefined();
    expect(
      graphqlBody.data?.contacts.items.some(
        (item) => item.id === contactBody.data.id,
      ),
    ).toBe(true);
  });
});
