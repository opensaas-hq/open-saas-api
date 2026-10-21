import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createEnv } from "@opensaas/core";
import { db, withRawTransaction } from "@opensaas/database";
import { createAuth } from "../auth";

const env = createEnv({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  AUTH_RATE_LIMIT_ENABLED: "false",
});

const hasDatabase =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

const describeIfDb = hasDatabase ? describe : describe.skip;

const WEB_ORIGIN = "http://localhost:3000";

describeIfDb("@opensaas/auth - Session telemetry wire-up (§3.5)", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        `TRUNCATE TABLE registration_code, waitlist_entry, "member", "organization",
         "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("session-creation hook populates the telemetry columns from headers", async () => {
    const auth = createAuth(env);

    const res = await auth.handler(
      new Request(`${WEB_ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: WEB_ORIGIN,
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          "cf-connecting-ip": "203.0.113.7",
          "cf-ipcountry": "MX",
          "cf-ipcity": "Mexico City",
          "x-client-timezone": "America/Mexico_City",
          "accept-language": "es-MX,es;q=0.9",
        },
        body: JSON.stringify({
          email: "telemetry@example.com",
          password: "password123",
          name: "Telemetry",
        }),
      }),
    );
    expect(res.status).toBe(200);

    const rows = await db.execute(
      `SELECT ip_address, user_agent, browser, os, device_type, language,
              timezone, country, city
       FROM "session"`,
    );
    expect(rows.length).toBe(1);
    const row = rows[0] as Record<string, unknown>;

    expect(row.ip_address).toBe("203.0.113.7");
    expect(row.user_agent).toContain("Chrome/122");
    expect(row.browser).toBe("Chrome");
    expect(row.os).toBe("macOS");
    expect(row.device_type).toBe("desktop");
    expect(row.language).toBe("es-MX");
    expect(row.timezone).toBe("America/Mexico_City");
    expect(row.country).toBe("MX");
    expect(row.city).toBe("Mexico City");
  });

  test("no telemetry column is left always-null: headers-only source still fills UA-derived fields", async () => {
    const auth = createAuth(env);

    const res = await auth.handler(
      new Request(`${WEB_ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: WEB_ORIGIN,
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        },
        body: JSON.stringify({
          email: "ua-only@example.com",
          password: "password123",
          name: "UA",
        }),
      }),
    );
    expect(res.status).toBe(200);

    const rows = await db.execute(
      `SELECT browser, os, device_type FROM "session"`,
    );
    const row = rows[0] as Record<string, unknown>;
    expect(row.browser).toBe("Safari");
    expect(row.os).toBe("iOS");
    expect(row.device_type).toBe("mobile");
  });
});
