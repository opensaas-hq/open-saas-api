import { type SQLWrapper, sql } from "drizzle-orm";

/**
 * Minimal probe surface, so tests can inject a fake without a real handle. The
 * parameter is typed as a Drizzle `SQLWrapper` (not `unknown`) so a real
 * `Database` handle is assignable without a cast.
 */
export type HealthProbe = {
  execute: (query: SQLWrapper) => Promise<unknown>;
};

/** Options for {@link probeDatabase}. */
export type ProbeOptions = {
  /** Milliseconds to wait for the probe before treating the database as down. */
  timeoutMs: number;
  /** Handle to probe. */
  db: HealthProbe;
};

/**
 * Probe the database with a trivial query, under a hard timeout.
 *
 * The probe is honest: there is no environment branching and no stub, so it
 * reports the real state of the connection. A database that is down — or that
 * hangs — is reported as down within the given timeout instead of blocking
 * the caller forever.
 *
 * The timeout is always explicit: the caller owns the budget (the readiness
 * endpoint reads `HEALTH_PROBE_TIMEOUT_MS`, §4.6), so the probe never depends
 * on a process-wide configuration.
 */
export async function probeDatabase(options: ProbeOptions): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("database health check timed out")),
      options.timeoutMs,
    );
  });

  try {
    await Promise.race([options.db.execute(sql`SELECT 1`), timeout]);
    return true;
  } catch {
    return false;
  }
}
