import { type Logger, fail, ok } from "@opensaas/core";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DatabaseProbe } from "../health/probe";
import type { Lifecycle } from "../lifecycle";
import type { AppEnv } from "../types";

/** The states the database circuit breaker can be in (§2.5). */
export type BreakerState = "closed" | "open" | "halfOpen";

/** The part of the circuit breaker the readiness endpoint reads. */
export type BreakerProbe = {
  /** Current state of the breaker. */
  getState: () => BreakerState;
};

/** Dependencies of the health routes. */
export type HealthRouterOptions = {
  /** Port the readiness probe runs against. */
  db: DatabaseProbe;
  /** Circuit breaker of the database client (§2.5). */
  breaker: BreakerProbe;
  /** Milliseconds the readiness probe may take. */
  timeoutMs: number;
  /** Lifecycle of the process: the readiness reports the draining state. */
  lifecycle: Lifecycle;
  /** Logger the readiness failures are written to. */
  logger: Logger;
};

/**
 * The health surface (§4.6).
 *
 * Three endpoints, with three different meanings:
 *
 * - `GET /healthz` — **liveness**: the process is up. It touches no
 *   dependency, so it answers fast and never fails because of the database.
 * - `GET /readyz` — **readiness**: the process can serve traffic. It probes
 *   the database under a hard timeout and reports the circuit breaker; it
 *   answers 503 when the database is down, when the breaker is open, or while
 *   the process is draining (§4.8).
 * - `GET /api/health` — the historical endpoint, kept as an alias of the
 *   readiness probe and marked as deprecated (RFC 8594) so the callers can
 *   migrate.
 *
 * None of them requires a session and none of them goes through the tenant
 * middleware: a probe must answer for an instance that cannot serve tenants.
 */
export const createHealthRouter = (
  options: HealthRouterOptions,
): Hono<AppEnv> => {
  const router = new Hono<AppEnv>();

  /** Liveness: the process is up. No dependency is touched. */
  router.get("/healthz", (c) =>
    c.json(
      ok({
        status: "alive",
        draining: options.lifecycle.isDraining(),
        timestamp: new Date().toISOString(),
      }),
    ),
  );

  /** Readiness: the dependencies are usable and the process is not draining. */
  const readiness = async (c: Context<AppEnv>) => {
    const draining = options.lifecycle.isDraining();

    if (draining) {
      return c.json(
        fail("SERVICE_UNAVAILABLE", "The process is shutting down", {
          reason: "draining",
        }),
        503,
      );
    }

    const breakerState = options.breaker.getState();

    if (breakerState === "open") {
      return c.json(
        fail("SERVICE_UNAVAILABLE", "The database circuit breaker is open", {
          reason: "circuit_open",
          breaker: breakerState,
        }),
        503,
      );
    }

    const databaseReady = await options.db.isReachable(options.timeoutMs);

    if (!databaseReady) {
      options.logger.error(
        "❌ Readiness probe failed: the database is unreachable",
      );

      return c.json(
        fail("SERVICE_UNAVAILABLE", "The database is unreachable", {
          reason: "database_unreachable",
          breaker: breakerState,
        }),
        503,
      );
    }

    return c.json(
      ok({
        status: "ready",
        database: "connected",
        breaker: breakerState,
        timestamp: new Date().toISOString(),
      }),
    );
  };

  router.get("/readyz", readiness);

  // The historical endpoint: same semantics as the readiness. It is marked as
  // deprecated by the deprecation middleware of the application (§4.10), the
  // same way the other legacy paths are.
  router.get("/api/health", async (c) => await readiness(c));

  return router;
};
