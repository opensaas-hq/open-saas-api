import { beforeEach, describe, expect, test } from "bun:test";
import { initConfig } from "@opensaas/core";
import app from "../index";

// The route reads the registration mode from validated config, so tests inject
// it through `initConfig` instead of mutating `process.env` between cases.
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/opensaas",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

const register = (body: Record<string, unknown>) =>
  app.fetch(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("Apps/API - Auth Registration Integration Routes (/api/auth/register)", () => {
  beforeEach(() => {
    initConfig({ ...baseEnv, REGISTRATION_MODE: "public" });
  });

  test("should register successfully and normalize email in public mode", async () => {
    const res = await register({
      email: "johndoe@example.com",
      password: "securepassword123",
      name: "John Doe",
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.email).toBe("johndoe@example.com");
    expect(data.data.status).toBe("active");
  });

  test("should reject registration with disposable email", async () => {
    const res = await register({
      email: "user@mailinator.com",
      password: "password123",
      name: "Burner User",
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("an invalid payload returns the 422 envelope with field details", async () => {
    const res = await register({
      email: "bad-email",
      password: "short",
      name: "",
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fieldErrors).toHaveProperty("email");
  });

  test("should set user status to waitlist when REGISTRATION_MODE is waiting_list", async () => {
    initConfig({ ...baseEnv, REGISTRATION_MODE: "waiting_list" });

    const res = await register({
      email: "waitlist.user@example.com",
      password: "password123",
      name: "Waitlist User",
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.status).toBe("waitlist");
  });

  test("should reject invite_code mode if no code is provided", async () => {
    initConfig({ ...baseEnv, REGISTRATION_MODE: "invite_code" });

    const res = await register({
      email: "invited.user@example.com",
      password: "password123",
      name: "Invited User",
    });

    expect(res.status).toBe(422);
  });
});
