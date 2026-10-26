import { afterAll, describe, expect, test } from "bun:test";
import { close } from "@opensaas/database";
import { Validator } from "@seriousme/openapi-schema-validator";
import {
  APP_ORIGIN,
  createTenant,
  createTestApp,
  hasTestDatabase,
  jsonHeaders,
} from "./support/app";

/**
 * The versioned contract (§4.10).
 *
 * The API publishes its own OpenAPI 3.1 document, generated from the schemas
 * the runtime uses. These tests prove four things: the document is a valid
 * OpenAPI 3.1 document, it describes every versioned route (and only those),
 * the Swagger UI page renders it, and the historical paths keep working while
 * announcing their own deprecation.
 */
const describeIfDb = hasTestDatabase() ? describe : describe.skip;

/** The runtime routes of the contract: the versioned product surface. */
const VERSIONED_PREFIX = "/api/v1/";

/** Endpoints served under `/api/v1` that are not part of the contract. */
const NOT_IN_CONTRACT = new Set(["/api/v1/openapi.json", "/api/v1/docs"]);

/** Unique slug per test, so the suites never collide on the unique column. */
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The app under test. */
const { app } = createTestApp();

/** Read the published document from the running application. */
const fetchDocument = async (): Promise<{
  status: number;
  contentType: string | null;
  body: Record<string, unknown>;
}> => {
  const res = await app.fetch(new Request(`${APP_ORIGIN}/api/v1/openapi.json`));

  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: (await res.json()) as Record<string, unknown>,
  };
};

/**
 * Turn the OpenAPI template form (`/api/v1/contacts/{id}`) into the Hono form
 * (`/api/v1/contacts/:id`), so the two route spellings can be compared.
 */
const toHonoPath = (path: string): string =>
  path.replaceAll(/\{([^}]+)\}/g, ":$1");

/** The paths of the document, as a `path -> methods` map. */
const documentedOperations = (
  document: Record<string, unknown>,
): Map<string, string[]> => {
  const paths = (document.paths ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  return new Map(
    Object.entries(paths).map(([path, operations]) => [
      toHonoPath(path),
      Object.keys(operations)
        .map((method) => method.toLowerCase())
        .sort(),
    ]),
  );
};

/**
 * The runtime routes of the versioned surface, as a `path -> methods` map.
 *
 * Hono registers one entry per handler of a route (middleware, validators,
 * handler), so the entries are deduplicated by path and method.
 */
const runtimeOperations = (): Map<string, string[]> => {
  const operations = new Map<string, Set<string>>();

  for (const route of app.routes) {
    if (!route.path.startsWith(VERSIONED_PREFIX)) continue;
    if (NOT_IN_CONTRACT.has(route.path)) continue;
    // `ALL` entries are middleware (the tenant resolution), not endpoints.
    if (route.method === "ALL") continue;

    const methods = operations.get(route.path) ?? new Set<string>();

    methods.add(route.method.toLowerCase());
    operations.set(route.path, methods);
  }

  return new Map(
    [...operations].map(([path, methods]) => [path, [...methods].sort()]),
  );
};

afterAll(async () => {
  await close();
});

describe("Apps/API - OpenAPI contract (/api/v1/openapi.json)", () => {
  test("is a valid OpenAPI 3.1 document", async () => {
    const { status, contentType, body } = await fetchDocument();

    expect(status).toBe(200);
    expect(contentType).toContain("application/json");
    expect(body.openapi).toBe("3.1.0");

    const validator = new Validator();
    const result = await validator.validate(body);

    // The validator reports no `errors` array when the document is valid.
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  test("documents every versioned route, and only those", async () => {
    const { body } = await fetchDocument();
    const documented = documentedOperations(body);
    const runtime = runtimeOperations();

    // Every runtime product route is described…
    for (const [path, methods] of runtime) {
      expect(documented.get(path)).toEqual(methods);
    }

    // …and the document describes nothing that is not served.
    expect([...documented.keys()].sort()).toEqual([...runtime.keys()].sort());
  });

  test("keeps the deprecated aliases out of the contract", async () => {
    const { body } = await fetchDocument();

    for (const path of Object.keys(body.paths as Record<string, unknown>)) {
      expect(path.startsWith("/api/v1/")).toBe(true);
    }
  });

  test("serves the Swagger UI page, which points at the document", async () => {
    const res = await app.fetch(new Request(`${APP_ORIGIN}/api/v1/docs`));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();

    expect(html).toContain("/api/v1/openapi.json");
    expect(html).toContain("swagger-ui");
  });
});

describeIfDb("Apps/API - Deprecated aliases (old-path behavior)", () => {
  test("a deprecated alias answers like its versioned successor, and says so", async () => {
    const { cookie } = await createTenant(app, {
      email: `legacy-${Date.now()}@example.com`,
      password: "password-123",
      name: "Legacy",
      slug: uniqueSlug("legacy"),
    });

    const legacyRes = await app.fetch(
      new Request(`${APP_ORIGIN}/api/contacts`, {
        headers: jsonHeaders(cookie),
      }),
    );

    expect(legacyRes.status).toBe(200);
    expect(legacyRes.headers.get("deprecation")).toBe("true");
    expect(legacyRes.headers.get("sunset")).not.toBeNull();
    expect(legacyRes.headers.get("link")).toBe(
      '</api/v1/contacts>; rel="successor-version"',
    );

    const versionedRes = await app.fetch(
      new Request(`${APP_ORIGIN}/api/v1/contacts`, {
        headers: jsonHeaders(cookie),
      }),
    );

    expect(versionedRes.status).toBe(200);
    expect(versionedRes.headers.get("deprecation")).toBeNull();
    expect(await legacyRes.json()).toEqual(await versionedRes.json());
  });

  test("marks the registration alias as deprecated too", async () => {
    const res = await app.fetch(
      new Request(`${APP_ORIGIN}/api/registration`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          email: `legacy-registration-${Date.now()}@example.com`,
          password: "password-123",
          name: "Legacy registration",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("deprecation")).toBe("true");
    expect(res.headers.get("link")).toBe(
      '</api/v1/registration>; rel="successor-version"',
    );
  });

  test("marks the historical health endpoint as deprecated", async () => {
    const res = await app.fetch(new Request(`${APP_ORIGIN}/api/health`));

    expect(res.headers.get("deprecation")).toBe("true");
    expect(res.headers.get("link")).toBe('</readyz>; rel="successor-version"');
  });
});
