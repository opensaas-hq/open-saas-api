import { describe, expect, test } from "bun:test";
import { createEnv } from "../config";
import { createLogger } from "../logger";

// Minimal valid configuration reused to build a validated env.
const validEnv = {
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/opensaas",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("@opensaas/core - Logger", () => {
  // createLogger takes an already validated env, so no process.env is touched.
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
});
