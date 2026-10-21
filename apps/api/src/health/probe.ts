/**
 * The readiness port of the health surface (§4.6).
 *
 * The health route depends on this port, not on the database package: the
 * route stays a thin adapter (§4.4) and the composition root
 * (`app.ts`) is the only place that knows how to reach a database.
 */
export type DatabaseProbe = {
  /**
   * Resolve to `true` when the database answers within the given budget, and
   * to `false` when it is down or does not answer in time.
   */
  isReachable: (timeoutMs: number) => Promise<boolean>;
};
