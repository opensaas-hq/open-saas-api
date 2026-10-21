import { describe, expect, test } from "bun:test";
import { createTestApp } from "./support/app";

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
