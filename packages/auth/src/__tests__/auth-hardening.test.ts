import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createEnv, getTrustedOrigins } from "@opensaas/core";
import { db, withRawTransaction } from "@opensaas/database";
import { createAuth } from "../auth";
import { CapturingEmailSender } from "./support/capturing-email";

const baseSource = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

const makeEnv = (overrides: Record<string, string> = {}) =>
  createEnv({ ...baseSource, ...overrides });

const hasDatabase =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

const describeIfDb = hasDatabase ? describe : describe.skip;

const WEB_ORIGIN = "http://localhost:3000";
const jsonHeaders = { "content-type": "application/json", origin: WEB_ORIGIN };

const resetTables = () =>
  withRawTransaction(async (tx) => {
    await tx.execute(
      `TRUNCATE TABLE registration_code, waitlist_entry, "member", "organization",
       "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
    );
  });

const signUp = async (auth: ReturnType<typeof createAuth>, email: string) =>
  auth.handler(
    new Request(`${WEB_ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: "password123", name: "User" }),
    }),
  );

describeIfDb("@opensaas/auth - Better Auth hardening (§3.4)", () => {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  describe("rate limiting", () => {
    test("N+1 failed attempts in the window yields 429 with X-Retry-After", async () => {
      const env = makeEnv({
        AUTH_RATE_LIMIT_ENABLED: "true",
        AUTH_RATE_LIMIT_WINDOW_S: "60",
        AUTH_RATE_LIMIT_MAX: "3",
      });
      const auth = createAuth(env);
      const attempt = () =>
        auth.handler(
          new Request(`${WEB_ORIGIN}/api/auth/sign-in/email`, {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              email: "nobody@example.com",
              password: "wrongpassword",
            }),
          }),
        );

      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await attempt()).status);

      // The first N attempts pass the limiter (and fail auth with 401);
      // the following ones are throttled.
      expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
      expect(statuses[3]).toBe(429);
      expect(statuses[4]).toBe(429);

      const throttled = await attempt();
      expect(throttled.status).toBe(429);
      // Better Auth emits the retry hint under `X-Retry-After`.
      expect(throttled.headers.get("x-retry-after")).toBeTruthy();
    });

    test("the limiter is disabled when AUTH_RATE_LIMIT_ENABLED=false", async () => {
      const env = makeEnv({ AUTH_RATE_LIMIT_ENABLED: "false" });
      const auth = createAuth(env);
      const attempt = () =>
        auth.handler(
          new Request(`${WEB_ORIGIN}/api/auth/sign-in/email`, {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              email: "nobody@example.com",
              password: "wrongpassword",
            }),
          }),
        );

      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) statuses.push((await attempt()).status);

      expect(statuses).not.toContain(429);
    });
  });

  describe("trustedOrigins", () => {
    test("a cookie flow from an untrusted origin is rejected with 403", async () => {
      const env = makeEnv({ TRUSTED_ORIGINS: "https://app.example" });
      const auth = createAuth(env, db);

      const res = await auth.handler(
        new Request(`${WEB_ORIGIN}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify({
            email: "victim@example.com",
            password: "password123",
            name: "Victim",
          }),
        }),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("INVALID_ORIGIN");
    });

    test("getTrustedOrigins merges BETTER_AUTH_URL with TRUSTED_ORIGINS", () => {
      const env = makeEnv({
        BETTER_AUTH_URL: "https://app.example",
        TRUSTED_ORIGINS: "https://a.example,https://b.example",
      });

      expect(getTrustedOrigins(env)).toEqual([
        "https://app.example",
        "https://a.example",
        "https://b.example",
      ]);
    });
  });

  describe("email verification and password reset", () => {
    test("sign-up sends a verification email whose link verifies the user", async () => {
      const sender = new CapturingEmailSender();
      const auth = createAuth(
        makeEnv({ AUTH_RATE_LIMIT_ENABLED: "false" }),
        db,
        { emailSender: sender },
      );

      const res = await signUp(auth, "verify@example.com");
      expect(res.status).toBe(200);

      const message = sender.lastWithSubject("Verify your email");
      expect(message).toBeDefined();
      expect(message?.to).toBe("verify@example.com");
      expect(message?.url).toBeTruthy();

      const token = new URL(message?.url ?? "").searchParams.get("token");
      const verify = await auth.handler(
        new Request(`${WEB_ORIGIN}/api/auth/verify-email?token=${token}`, {
          headers: { origin: WEB_ORIGIN },
        }),
      );
      expect(verify.status).toBe(200);

      const rows = await db.execute(
        `SELECT email_verified FROM "user" WHERE email = 'verify@example.com'`,
      );
      expect(rows[0]?.email_verified).toBe(true);
    });

    test("password reset completes end-to-end and rotates sessions", async () => {
      const sender = new CapturingEmailSender();
      const auth = createAuth(
        makeEnv({ AUTH_RATE_LIMIT_ENABLED: "false" }),
        db,
        { emailSender: sender },
      );

      const signup = await signUp(auth, "reset@example.com");
      expect(signup.status).toBe(200);

      const sessionCount = async () => {
        const rows = await db.execute(
          `SELECT count(*)::int AS c FROM "session"`,
        );
        return Number(rows[0]?.c ?? 0);
      };
      expect(await sessionCount()).toBe(1);

      sender.clear();
      const req = await auth.handler(
        new Request(`${WEB_ORIGIN}/api/auth/request-password-reset`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            email: "reset@example.com",
            redirectTo: `${WEB_ORIGIN}/reset`,
          }),
        }),
      );
      expect(req.status).toBe(200);

      const message = sender.lastWithSubject("Reset your password");
      expect(message?.to).toBe("reset@example.com");
      // The token lives in the link path; it must never be logged.
      const token = new URL(message?.url ?? "").pathname.split("/").pop();
      expect(token).toBeTruthy();

      const reset = await auth.handler(
        new Request(`${WEB_ORIGIN}/api/auth/reset-password`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ newPassword: "newpassword456", token }),
        }),
      );
      expect(reset.status).toBe(200);

      // The old password no longer works and the new one does.
      const oldLogin = await auth.handler(
        new Request(`${WEB_ORIGIN}/api/auth/sign-in/email`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            email: "reset@example.com",
            password: "password123",
          }),
        }),
      );
      expect(oldLogin.status).toBe(401);

      const newLogin = await auth.handler(
        new Request(`${WEB_ORIGIN}/api/auth/sign-in/email`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            email: "reset@example.com",
            password: "newpassword456",
          }),
        }),
      );
      expect(newLogin.status).toBe(200);

      // revokeSessionsOnPasswordReset clears the pre-reset session.
      expect(await sessionCount()).toBe(1); // only the fresh sign-in session
    });
  });

  describe("non-delivering default sender", () => {
    test("noop sender never logs message contents", async () => {
      const originalWrite = process.stdout.write.bind(process.stdout);
      const captured: string[] = [];
      process.stdout.write = ((chunk: string | Uint8Array) => {
        captured.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as typeof process.stdout.write;

      try {
        // Default createAuth uses noopEmailSender.
        const auth = createAuth(makeEnv({ AUTH_RATE_LIMIT_ENABLED: "false" }));
        await signUp(auth, "quiet@example.com");
      } finally {
        process.stdout.write = originalWrite;
      }

      const output = captured.join("");
      expect(output).not.toMatch(/token=/);
      expect(output).not.toMatch(/verify-email\?/);
    });
  });
});
