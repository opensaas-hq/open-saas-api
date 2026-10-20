import { describe, expect, test } from "bun:test";
import app from "../index";

describe("Apps/API - Health Check Route", () => {
  test("GET /api/health should return status ok and environment", async () => {
    const req = new Request("http://localhost/api/health");
    const res = await app.fetch(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("status", "ok");
    expect(body.data).toHaveProperty("database", "connected");
  });

  test("an unknown route returns the JSON error envelope, not plain text", async () => {
    const res = await app.fetch(new Request("http://localhost/api/nope"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.details).toHaveProperty("path", "/api/nope");
  });
});
