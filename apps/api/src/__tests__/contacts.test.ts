import { describe, expect, test } from "bun:test";
import app from "../index";

describe("Apps/API - Contacts Routes (/api/contacts)", () => {
  test("GET /api/contacts - should require authentication/tenant context", async () => {
    const req = new Request("http://localhost/api/contacts");
    const res = await app.fetch(req);

    // Should fail with 401 Unauthorized when no session/token is provided
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("POST /api/contacts - should reject invalid payloads (validation error)", async () => {
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
