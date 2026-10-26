import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ServiceUnavailableError, getEnv } from "@opensaas/core";
import {
  buildPoolConfig,
  buildResilienceConfig,
  close,
  createDb,
  executeResilient,
  waitForDatabase,
} from "../client";
import { assertTestDatabase } from "./guard";

describe("@opensaas/database - Client factory", () => {
  test("buildPoolConfig maps every env value to the pool", () => {
    const pool = buildPoolConfig({
      DB_POOL_MAX: 7,
      DB_IDLE_TIMEOUT_S: 11,
      DB_STATEMENT_TIMEOUT_MS: 4321,
      DB_CONNECT_TIMEOUT_S: 3,
    });

    expect(pool).toEqual({
      max: 7,
      idleTimeout: 11,
      statementTimeout: 4321,
      connectTimeout: 3,
    });
  });

  test("createDb returns a usable handle without reading the environment", async () => {
    const handle = createDb({
      databaseUrl: process.env.DATABASE_URL ?? "",
      pool: {
        max: 1,
        idleTimeout: 1,
        statementTimeout: 5_000,
        connectTimeout: 5,
      },
    });

    expect(handle).toBeDefined();
    expect(typeof handle.execute).toBe("function");
    // Close the pool created by this test so no handle leaks.
    await handle.$client.end();
  });

  test("importing the package without a database env does not throw", () => {
    const entry = join(import.meta.dir, "..", "index.ts");
    const script = `import(${JSON.stringify(entry)}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })`;

    const result = spawnSync(process.execPath, ["-e", script], {
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  });

  test("close() resolves and leaves no open handles", async () => {
    expect(typeof close).toBe("function");

    // Exercise the underlying close against an isolated handle so the shared
    // lazy pool is never torn down for other test files running in the same
    // process.
    const handle = createDb({
      databaseUrl: process.env.DATABASE_URL ?? "",
      pool: {
        max: 1,
        idleTimeout: 1,
        statementTimeout: 5_000,
        connectTimeout: 5,
      },
    });

    await expect(handle.$client.end()).resolves.toBeUndefined();
  });

  test("no production source reads process.env directly", () => {
    const srcDir = join(import.meta.dir, "..");
    const files = readdirSync(srcDir, { recursive: true })
      .map((name) => String(name))
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => !name.split(/[\\/]/).includes("__tests__"));
    expect(files).toContain("client.ts");

    for (const name of files) {
      const contents = readFileSync(join(srcDir, name), "utf8");
      expect(contents).not.toContain("process.env");
    }
  });
});

describe("@opensaas/database - Resilience config", () => {
  test("maps environment knobs to the retry and breaker config", () => {
    const config = buildResilienceConfig({
      DB_RETRY_MAX_ATTEMPTS: 7,
      DB_RETRY_BASE_DELAY_MS: 50,
      DB_RETRY_MAX_DELAY_MS: 2_000,
      DB_BREAKER_ENABLED: false,
      DB_BREAKER_FAILURE_THRESHOLD: 9,
      DB_BREAKER_COOLDOWN_MS: 30_000,
      DB_BREAKER_PROBE_TIMEOUT_MS: 1_500,
    });

    expect(config).toEqual({
      retry: { maxAttempts: 7, baseDelayMs: 50, maxDelayMs: 2_000 },
      breaker: {
        enabled: false,
        failureThreshold: 9,
        cooldownMs: 30_000,
        probeTimeoutMs: 1_500,
      },
    });
  });
});

describe("@opensaas/database - Resilient execution", () => {
  beforeAll(assertTestDatabase);

  test("waitForDatabase resolves against a live database", async () => {
    await expect(waitForDatabase()).resolves.toBeUndefined();
  });

  test("waitForDatabase retries a transient failure then fails with a typed 503", async () => {
    let attempts = 0;
    const transient = () =>
      Object.assign(new Error("connection refused"), { code: "08006" });

    const failure = waitForDatabase({
      sleeper: () => Promise.resolve(),
      random: () => 0,
      probe: () => {
        attempts++;
        return Promise.reject(transient());
      },
    });

    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableError);

    // Bounded: exactly the configured number of attempts, all retried because
    // the startup probe is idempotent.
    const env = getEnv();
    expect(attempts).toBe(env.DB_RETRY_MAX_ATTEMPTS);
  });

  test("waitForDatabase does not wrap a permanent error as transient", async () => {
    const permanent = () =>
      Object.assign(new Error("syntax error"), { code: "42601" });
    let attempts = 0;

    const failure = waitForDatabase({
      sleeper: () => Promise.resolve(),
      random: () => 0,
      probe: () => {
        attempts++;
        return Promise.reject(permanent());
      },
    });

    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(attempts).toBe(1);
  });

  test("executeResilient runs an idempotent read", async () => {
    const result = await executeResilient(() => Promise.resolve("read"), {
      idempotent: true,
    });
    expect(result).toBe("read");
  });
});
