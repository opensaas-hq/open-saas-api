#!/usr/bin/env bun

const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const API_ORIGIN = process.env.DEMO_ORIGIN ?? API_URL;
const EMAIL =
  process.env.DEMO_EMAIL ??
  `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const PASSWORD = process.env.DEMO_PASSWORD ?? "Password123!";
const NAME = process.env.DEMO_NAME ?? "Demo User";

type SuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: unknown;
};

type ErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

type Organization = {
  id: string;
  name: string;
  slug: string;
};

type Branch = {
  id: string;
  name: string;
};

type Contact = {
  id: string;
  name: string;
  email: string | null;
  branchId: string | null;
};

type SessionResponse = {
  user: {
    id: string;
    email: string;
  };
};

type CookieJar = {
  header: string;
};

const step = (label: string) => {
  console.log(`\n${label}`);
};

const updateCookies = (jar: CookieJar, res: Response) => {
  const cookies = res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]);

  if (cookies.length > 0) {
    jar.header = cookies.filter(Boolean).join("; ");
  }
};

const request = async <T>(
  jar: CookieJar,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set("origin", API_ORIGIN);

  if (init.body) {
    headers.set("content-type", "application/json");
  }

  if (jar.header) {
    headers.set("cookie", jar.header);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  updateCookies(jar, res);

  const text = await res.text();
  const body = text ? (JSON.parse(text) as T | ErrorEnvelope) : undefined;

  if (!res.ok) {
    const error = body as ErrorEnvelope | undefined;
    throw new Error(
      `${init.method ?? "GET"} ${path} failed with ${res.status}: ${
        error?.error?.message ?? text
      }`,
    );
  }

  return body as T;
};

const envelopeData = <T>(body: Envelope<T>): T => {
  if (!body.success) {
    throw new Error(`${body.error.code}: ${body.error.message}`);
  }

  return body.data;
};

const main = async () => {
  const jar: CookieJar = { header: "" };

  step("1. Health");
  const health = await request<{ status: string }>(jar, "/healthz");
  console.log(health);

  step("2. Register");
  const registration = await request<
    Envelope<{ status: string; email: string }>
  >(jar, "/api/v1/registration", {
    method: "POST",
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      name: NAME,
    }),
  });
  console.log(envelopeData(registration));

  step("3. Sign in");
  const session = await request<SessionResponse>(
    jar,
    "/api/auth/sign-in/email",
    {
      method: "POST",
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
      }),
    },
  );
  console.log({ userId: session.user.id, email: session.user.email });

  step("4. List organizations");
  const organizations = await request<Organization[]>(
    jar,
    "/api/auth/organization/list",
  );

  if (organizations.length === 0) {
    throw new Error("the registration did not create an organization");
  }

  const organization = organizations[0] as Organization;
  console.log({ id: organization.id, name: organization.name });

  step("5. Activate organization");
  await request<Organization>(jar, "/api/auth/organization/set-active", {
    method: "POST",
    body: JSON.stringify({ organizationId: organization.id }),
  });

  step("6. Create branch");
  const branch = envelopeData(
    await request<Envelope<Branch>>(jar, "/api/v1/branches", {
      method: "POST",
      body: JSON.stringify({ name: "Demo branch" }),
    }),
  );
  console.log(branch);

  step("7. Create contact");
  const contact = envelopeData(
    await request<Envelope<Contact>>(jar, "/api/v1/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        branchId: branch.id,
      }),
    }),
  );
  console.log(contact);

  step("8. List contacts through REST");
  const contacts = envelopeData(
    await request<Envelope<Contact[]>>(jar, "/api/v1/contacts"),
  );
  console.log(contacts.map((item) => ({ id: item.id, name: item.name })));

  step("9. Query contacts through GraphQL");
  const graphql = await request<{
    data?: { contacts: { items: Contact[] } };
    errors?: Array<{ message: string }>;
  }>(jar, "/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: `
        query DemoContacts {
          contacts {
            items { id name email branchId }
          }
        }
      `,
    }),
  });

  if (graphql.errors?.length) {
    throw new Error(graphql.errors.map((error) => error.message).join("; "));
  }

  console.log(graphql.data?.contacts.items);

  console.log("\nDemo complete.");
  console.log(`OpenAPI: ${API_URL}/api/v1/docs`);
  console.log(`GraphQL: ${API_URL}/graphql`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
