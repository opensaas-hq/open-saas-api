import { describe, expect, test } from "bun:test";
import { createEnv, createLogger } from "@opensaas/core";
import { Hono } from "hono";
import { createLifecycle } from "../lifecycle";
import { createInFlightMiddleware } from "../middleware/in-flight";
import { type ShutdownController, createShutdownController } from "../shutdown";
import { createLogCapture, createTestApp } from "./support/app";

/** A logger that writes nowhere, so the shutdown tests stay quiet. */
const createSilentLogger = () => {
  const capture = createLogCapture();

  return createLogger(
    createEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      PORT: "3015",
      DATABASE_URL: "postgresql://localhost:5432/opensaas_unused",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3015",
    }),
    capture.destination,
  );
};

/**
 * Build a controller whose exit code is captured instead of terminating the
 * test process.
 */
const createTestController = (
  overrides: Partial<Parameters<typeof createShutdownController>[0]>,
): { controller: ShutdownController; exits: number[] } => {
  const exits: number[] = [];

  const controller = createShutdownController({
    lifecycle: createLifecycle(),
    stopAccepting: () => {},
    closeDatabase: async () => {},
    flushLogs: () => {},
    exit: (code) => exits.push(code),
    drainTimeoutMs: 500,
    logger: createSilentLogger(),
    ...overrides,
  });

  return { controller, exits };
};

describe("Apps/API - The graceful shutdown (§4.8)", () => {
  test("the readiness flips to 503 before the connections stop being drained", async () => {
    const lifecycle = createLifecycle();
    const { app } = createTestApp({}, { lifecycle });

    let readinessAtStop: number | undefined;

    const { controller } = createTestController({
      lifecycle,
      stopAccepting: async () => {
        // The readiness must already answer 503 when the accept loop stops.
        const res = await app.fetch(new Request("http://localhost/readyz"));
        readinessAtStop = res.status;
      },
    });

    await controller.shutdown("SIGTERM");

    expect(readinessAtStop).toBe(503);
  });

  test("the shutdown is idempotent: a second signal exits immediately", async () => {
    const lifecycle = createLifecycle();
    // A request that never finishes: the drain blocks on it.
    lifecycle.beginRequest();

    const { controller, exits } = createTestController({
      lifecycle,
      drainTimeoutMs: 500,
    });

    const first = controller.shutdown("SIGTERM");
    await Bun.sleep(10);

    const startedAt = Date.now();
    await controller.shutdown("SIGINT");
    const elapsed = Date.now() - startedAt;

    // The second signal exits right away, with the conventional code.
    expect(exits).toEqual([130]);
    expect(elapsed).toBeLessThan(250);

    // The first sequence is still running; it ends with the drain timeout.
    await first;
    expect(exits).toEqual([130, 1]);
  });

  test("the process exits non-zero when the drain times out", async () => {
    const lifecycle = createLifecycle();
    lifecycle.beginRequest();

    const { controller, exits } = createTestController({
      lifecycle,
      drainTimeoutMs: 100,
    });

    const startedAt = Date.now();
    await controller.shutdown("SIGTERM");
    const elapsed = Date.now() - startedAt;

    expect(exits).toEqual([1]);
    // The process gives up within the budget, it does not hang.
    expect(elapsed).toBeLessThan(2_000);
  });

  test("the process exits 0 when the drain completes", async () => {
    const { controller, exits } = createTestController({});

    await controller.shutdown("SIGTERM");

    expect(exits).toEqual([0]);
  });

  test("an in-flight request completes while the server stops accepting connections", async () => {
    const lifecycle = createLifecycle();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const app = new Hono();
    app.use("*", createInFlightMiddleware(lifecycle));
    app.get("/slow", async (c) => {
      await gate;
      return c.text("done");
    });

    const server = Bun.serve({ port: 0, fetch: app.fetch });
    const baseUrl = `http://localhost:${server.port}`;

    try {
      const inFlight = fetch(`${baseUrl}/slow`);

      // Wait until the request reached the handler.
      await Bun.sleep(50);

      const { controller, exits } = createTestController({
        lifecycle,
        // `stop(false)`: the accept loop closes, the in-flight request lives.
        stopAccepting: () => server.stop(false),
        drainTimeoutMs: 5_000,
      });

      const shutdown = controller.shutdown("SIGTERM");

      // The drain waits for the in-flight request.
      release?.();
      const res = await inFlight;

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("done");

      await shutdown;
      expect(exits).toEqual([0]);

      // A new connection is refused: the server stopped accepting.
      await expect(fetch(`${baseUrl}/slow`)).rejects.toThrow();
    } finally {
      server.stop(true);
    }
  });
});
