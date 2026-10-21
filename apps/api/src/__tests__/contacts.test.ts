import { describe, expect, test } from "bun:test";
import { createTestApp } from "./support/app";

describe("Apps/API - Contacts Routes (/api/contacts)", () => {
  test("GET /api/contacts - should require authentication/tenant context", async () => {
    const { app } = createTestApp();

    const req = new Request("http://localhost/api/contacts");
    const res = await app.fetch(req);

    // Should fail with 401 Unauthorized when no session/token is provided
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("GET /api/contacts with a bad query still requires auth first (401)", async () => {
    const { app } = createTestApp();

    // The tenant middleware runs before validation, so an unauthenticated
    // caller gets the 401 envelope regardless of query shape.
    const res = await app.fetch(
      new Request("http://localhost/api/contacts?limit=abc"),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty("code");
  });

  test("POST /api/contacts - should reject invalid payloads (validation error)", async () => {
    const { app } = createTestApp();

    const req = new Request("http://localhost/api/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Missing required 'name' field
        phone: "+525555555555",
      }),
    });

    const res = await app.fetch(req);
    // Should fail authorization before or validation if mock session exists
    expect([401, 400, 422].includes(res.status)).toBe(true);
  });
});
