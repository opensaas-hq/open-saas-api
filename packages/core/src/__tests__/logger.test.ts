import { describe, expect, test } from "bun:test";
import pino, { type Logger } from "pino";
import { createEnv } from "../config";
import {
  createLogger,
  getLogger,
  getRequestContext,
  resetLogger,
  setLogger,
  withRequestContext,
} from "../logger";

// Minimal valid configuration reused to build a validated env.
const validEnv = {
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/opensaas",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

/**
 * Build a real pino logger that writes to an in-memory sink, so assertions run
 * against actual serialized output rather than a hand-stubbed mock. Redaction
 * is left off here; the dedicated redaction tests below exercise the real
 * factory with its redaction config.
 */
const captureLogger = () => {
  const lines: string[] = [];
  const sink = pino(
    { level: "trace", redact: { paths: [], censor: "[REDACTED]" } },
    {
      write: (chunk: string) => {
        lines.push(chunk);
      },
    },
  ) as Logger;

  return { logger: sink, lines };
};

describe("@opensaas/core - Logger", () => {
  test("createLogger reads the level from the injected env", () => {
    const env = createEnv({ ...validEnv, LOG_LEVEL: "debug" });
    const logger = createLogger(env);

    expect(logger.level).toBe("debug");
  });

  test("the default level is info when not injected", () => {
    const env = createEnv(validEnv);
    const logger = createLogger(env);

    expect(logger.level).toBe("info");
  });

  test("an invalid LOG_LEVEL fails at config validation, before the logger exists", () => {
    expect(() => createEnv({ ...validEnv, LOG_LEVEL: "loud" })).toThrow(
      /LOG_LEVEL/,
    );
  });

  test("the fake logger seam captures output without touching process.env", () => {
    const { logger, lines } = captureLogger();
    setLogger(logger);

    try {
      getLogger().info("hello");
      expect(lines.join("")).toContain("hello");
    } finally {
      resetLogger();
    }
  });

  test("every line inside a context carries the same requestId, including nested async", async () => {
    const { logger, lines } = captureLogger();
    setLogger(logger);

    try {
      await withRequestContext({ requestId: "req-123" }, async () => {
        getLogger().info("outer");
        await Promise.resolve().then(() => {
          getLogger().info("nested");
        });
      });

      const parsed = lines.map((line) => JSON.parse(line));
      expect(parsed).toHaveLength(2);
      expect(parsed.every((entry) => entry.requestId === "req-123")).toBe(true);
    } finally {
      resetLogger();
    }
  });

  test("optional context fields are bound only when present", () => {
    const { logger, lines } = captureLogger();
    setLogger(logger);

    try {
      withRequestContext(
        { requestId: "req-1", tenantId: "org-1", userId: "user-1" },
        () => getLogger().info("scoped"),
      );

      const entry = JSON.parse(lines[0] ?? "{}");
      expect(entry.requestId).toBe("req-1");
      expect(entry.tenantId).toBe("org-1");
      expect(entry.userId).toBe("user-1");
      expect(entry).not.toHaveProperty("route");
    } finally {
      resetLogger();
    }
  });

  test("getRequestContext returns undefined outside a request", () => {
    expect(getRequestContext()).toBeUndefined();
  });

  test("sensitive fields never reach the serialized output", () => {
    const lines: string[] = [];
    // Real factory (real redaction config), writing to an in-memory sink.
    const logger = createLogger(
      createEnv({ ...validEnv, NODE_ENV: "production" }),
      { write: (chunk: string) => lines.push(chunk) },
    );

    logger.info({
      authorization: "Bearer secret",
      password: "hunter2",
      "set-cookie": "session=abc",
      token: "jwt",
      nested: { cookie: "c", keep: "visible" },
    });

    const serialized = lines.join("");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("session=abc");
    expect(serialized).not.toContain("jwt");
    expect(serialized).toContain("visible");
  });

  // Known gap: pino `redact.paths` are case-sensitive, so capitalized field
  // names (how HTTP headers usually arrive) slip past the logger's redaction.
  // The pure `redact()` helper does not have this limitation; parity between
  // the two mechanisms is tracked as debt for the audit work (§1.6).
  test("capitalized field names are NOT redacted by the logger (known gap)", () => {
    const lines: string[] = [];
    const logger = createLogger(
      createEnv({ ...validEnv, NODE_ENV: "production" }),
      { write: (chunk: string) => lines.push(chunk) },
    );

    logger.info({ Authorization: "Bearer secret", Password: "hunter2" });

    const serialized = lines.join("");
    expect(serialized).toContain("Bearer secret");
    expect(serialized).toContain("hunter2");
  });
});
