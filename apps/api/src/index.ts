import { createAuth } from "@opensaas/auth";
import { createLogger, getEnv, initConfig } from "@opensaas/core";
import {
  assertRlsEnforcement,
  close,
  db,
  executeResilient,
  waitForDatabase,
} from "@opensaas/database";
import { createApp } from "./app";
import { createLifecycle } from "./lifecycle";
import { createShutdownController } from "./shutdown";

// Explicit boot: validate configuration and abort with a report if it is
// missing or invalid. Must run before any config value is read.
initConfig();

// Derive local env/logger from the factories instead of importing singletons.
// The logger is built here and injected into the app: no request-scoped code
// reaches for a process-wide logger anymore (§4.5, TD-11).
const env = getEnv();
const logger = createLogger(env);

// The auth instance is built here and injected into the app (§4.7): nothing
// reads the environment at import time anymore.
const auth = createAuth(env, db);

// The lifecycle is shared by the app (readiness) and the shutdown controller
// (drain), so the readiness endpoint can report the draining state (§4.8).
const lifecycle = createLifecycle();

// Wait for the database before serving traffic: a process that cannot reach
// its database must fail at boot, not on the first request (§2.5).
await waitForDatabase();

// When row-level security is on, the process proves it before serving a
// single request: the effective role must not bypass the policies, every
// protected table must enforce them, and the tenant GUC must work. A
// misconfigured connection fails the boot instead of serving traffic with an
// unenforced tenancy boundary (§2.5, TD-38).
if (env.RLS_ENABLED) {
  const report = await executeResilient(() => assertRlsEnforcement(db), {
    idempotent: true,
  });

  logger.info(
    `🛡️ Row-level security verified for the role "${report.role}" on ${report.tables.length} tables`,
  );
}

const app = createApp({ env, db, auth, logger, lifecycle });

// The server is started explicitly (instead of the default export) so the
// shutdown controller can stop accepting new connections while the in-flight
// requests are drained (§4.8).
const server = Bun.serve({
  port: Number(env.PORT),
  fetch: app.fetch,
});

const shutdown = createShutdownController({
  lifecycle,
  // `stop(false)` closes the idle connections and stops the accept loop, but
  // leaves the in-flight requests alone: they are drained, not cut.
  stopAccepting: () => server.stop(false),
  closeDatabase: close,
  flushLogs: () => logger.flush(),
  exit: (code) => process.exit(code),
  drainTimeoutMs: env.SHUTDOWN_DRAIN_TIMEOUT_MS,
  logger,
});

shutdown.install();

logger.info(
  `🚀 Starting API server on port ${env.PORT} in ${env.NODE_ENV} mode...`,
);

export { app, server, shutdown };
