import { getEnv } from "@opensaas/core";
import { sql } from "drizzle-orm";
import { getDb } from "./client";

/** Minimal probe surface, so tests can inject a fake without a real handle. */
export type HealthProbe = {
  execute: (query: unknown) => Promise<unknown>;
};

/** Options for {@link checkDatabaseHealth}. */
export type CheckDatabaseHealthOptions = {
  /** Milliseconds to wait for the probe before treating the database as down. */
  timeoutMs?: number;
  /** Handle to probe; defaults to the shared lazy handle (for tests/DI). */
  db?: HealthProbe;
};

/**
 * Timeout used when a caller does not pass one. Reads the validated env's
 * `DB_BREAKER_PROBE_TIMEOUT_MS` so the same recovery budget applies to the
 * breaker probe and this health probe, with a safe fallback for unit tests
 * that run without an initialized environment.
 */
const defaultTimeoutMs = (): number => {
  try {
    return getEnv().DB_BREAKER_PROBE_TIMEOUT_MS;
  } catch {
    return 2_000;
  }
};

/**
 * Probe the database with a trivial query. No environment branching and no test
 * mocking: this reports the real state of the connection, so a test that wants
 * a fake must inject one via `db`. The readiness endpoint and its behavior live
 * in `apps/api` (§4.6).
 */
export async function checkDatabaseHealth(
  options: CheckDatabaseHealthOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs();
  const executor = options.db ?? getDb();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("database health check timed out")),
      timeoutMs,
    );
  });

  try {
    await Promise.race([executor.execute(sql`SELECT 1`), timeout]);
    return true;
  } catch {
    return false;
  }
}
