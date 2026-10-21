import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "@opensaas/core";
import { createDb, getBreaker, resetBreaker } from "@opensaas/database";
import { createLifecycle } from "../lifecycle";
import { createTestApp, hasTestDatabase } from "./support/app";

const describeIfDb = hasTestDatabase() ? describe : describe.skip;

/**
 * A database handle pointing at a closed port: connecting to it fails
 * immediately, so the readiness probe reports the real "the database is down"
 * state instead of a stubbed one (§4.6 AC2).
 */
const createUnreachableDb = () =>
  createDb({
    databaseUrl: "postgresql://postgres:postgres@127.0.0.1:1/unreachable",
    pool: {
      max: 1,
      idleTimeout: 1,
      statementTimeout: 1_000,
      connectTimeout: 1,
    },
  });

describe("Apps/API - The health surface (§4.6)", () => {
  test("GET /healthz answers 200 without a session and without touching the database", async () => {
    const unreachable = createUnreachableDb();
    const { app } = createTestApp({}, { db: unreachable });

    const res = await app.fetch(new Request("http://localhost/healthz"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("status", "alive");

    await unreachable.$client.end();
  });

  test("GET /healthz answers 200 while the process is draining", async () => {
    const lifecycle = createLifecycle();
    lifecycle.beginDrain();

    const { app } = createTestApp({}, { lifecycle });

    const res = await app.fetch(new Request("http://localhost/healthz"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty("draining", true);
  });

  test("GET /readyz answers 503 when the circuit breaker is open", async () => {
    // The real breaker of the database client, tripped with real failures.
    // The reset comes first: it drops the memoized instance, so the next
    // `getBreaker()` (the one the app reads) is a fresh, closed breaker.
    resetBreaker();
    const breaker = getBreaker();

    const threshold = getEnv().DB_BREAKER_FAILURE_THRESHOLD;

    for (let attempt = 0; attempt <= threshold; attempt++) {
      await breaker
        .execute(() => Promise.reject(new Error("database is down")))
        .catch(() => undefined);
    }

    try {
      expect(breaker.getState()).toBe("open");

      const { app } = createTestApp();

      const res = await app.fetch(new Request("http://localhost/readyz"));
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(body.error.details).toHaveProperty("reason", "circuit_open");
    } finally {
      // The breaker is a process-wide singleton: restore it for the next suite.
      resetBreaker();
    }
  });

  test("the health surface reads no environment variable (§4.6)", async () => {
    // A probe that branches on the environment could report a healthy
    // database that is down. The readiness depends on the injected port and
    // the injected timeout only.
    const source = readFileSync(
      join(import.meta.dir, "..", "routes", "health.ts"),
      "utf8",
    );

    expect(source).not.toContain("process.env");
    expect(source).not.toContain("NODE_ENV");
  });

  test("GET /readyz answers 503 while the process is draining (§4.8)", async () => {
    const lifecycle = createLifecycle();
    lifecycle.beginDrain();

    const { app } = createTestApp({}, { lifecycle });

    const res = await app.fetch(new Request("http://localhost/readyz"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.details).toHaveProperty("reason", "draining");
  });

  test("GET /readyz answers 503 within the timeout when the database is down", async () => {
    const unreachable = createUnreachableDb();
    const { app } = createTestApp(
      { HEALTH_PROBE_TIMEOUT_MS: 2_000 },
      { db: unreachable },
    );

    const startedAt = Date.now();
    const res = await app.fetch(new Request("http://localhost/readyz"));
    const elapsed = Date.now() - startedAt;
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details).toHaveProperty("reason", "database_unreachable");
    // The probe never hangs: the answer comes within the configured budget.
    expect(elapsed).toBeLessThan(2_000);

    await unreachable.$client.end();
  });
});

describeIfDb("Apps/API - The health surface (with database)", () => {
  test("GET /readyz answers 200 when the database answers", async () => {
    const { app } = createTestApp();

    const res = await app.fetch(new Request("http://localhost/readyz"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("status", "ready");
    expect(body.data).toHaveProperty("database", "connected");
    expect(body.data).toHaveProperty("breaker", "closed");
  });

  test("GET /api/health is a deprecated alias of the readiness", async () => {
    const { app } = createTestApp();

    const res = await app.fetch(new Request("http://localhost/api/health"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).toBe("true");
    expect(res.headers.get("link")).toContain("/readyz");
    expect(body.data).toHaveProperty("status", "ready");
  });
});
