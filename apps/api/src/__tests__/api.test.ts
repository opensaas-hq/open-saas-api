import { describe, expect, test } from "bun:test";
import app from "../index";

describe("Apps/API - Health Check Route", () => {
  test("GET /api/health should return status ok and environment", async () => {
    const req = new Request("http://localhost/api/health");
    const res = await app.fetch(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty("status", "ok");
    expect(data).toHaveProperty("environment");
  });
});
