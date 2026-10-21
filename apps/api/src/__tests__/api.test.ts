import { describe, expect, test } from "bun:test";
import { createTestApp, hasTestDatabase } from "./support/app";

describe("Apps/API - Health Check Route", () => {
  test("an unknown route returns the JSON error envelope, not plain text", async () => {
    const { app } = createTestApp();

    const res = await app.fetch(new Request("http://localhost/api/nope"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.details).toHaveProperty("path", "/api/nope");
  });
});

const describeIfDb = hasTestDatabase() ? describe : describe.skip;

describeIfDb("Apps/API - Health Check Route (with database)", () => {
  test("GET /api/health should return status ok and environment", async () => {
    const { app } = createTestApp();

    const req = new Request("http://localhost/api/health");
    const res = await app.fetch(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("status", "ok");
    expect(body.data).toHaveProperty("database", "connected");
  });
});
