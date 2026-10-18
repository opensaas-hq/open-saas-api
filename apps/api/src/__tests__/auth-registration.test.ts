import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";

describe("Apps/API - Auth Registration Integration Routes (/api/auth/register)", () => {
  beforeEach(() => {
    process.env.REGISTRATION_MODE = "";
    process.env.DISPOSABLE_EMAIL_DOMAINS = "";
  });

  test("should register successfully and normalize email in public mode", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "johndoe@example.com",
        password: "securepassword123",
        name: "John Doe",
      }),
    });

    const res = await app.fetch(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.email).toBe("johndoe@example.com");
    expect(data.data.status).toBe("active");
  });

  test("should reject registration with disposable email", async () => {
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@mailinator.com",
        password: "password123",
        name: "Burner User",
      }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(422);
  });

  test("should set user status to waitlist when REGISTRATION_MODE is waiting_list", async () => {
    process.env.REGISTRATION_MODE = "waiting_list";

    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "waitlist.user@example.com",
        password: "password123",
        name: "Waitlist User",
      }),
    });

    const res = await app.fetch(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.status).toBe("waitlist");
  });

  test("should reject invite_code mode if no code is provided", async () => {
    process.env.REGISTRATION_MODE = "invite_code";

    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "invited.user@example.com",
        password: "password123",
        name: "Invited User",
      }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(422);
  });
});
