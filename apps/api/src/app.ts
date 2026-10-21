import type { AuthInstance } from "@opensaas/auth";
import {
  AppError,
  type Env,
  type Logger,
  NotFoundError,
  fail,
  ok,
  statusFromError,
} from "@opensaas/core";
import type { Database } from "@opensaas/database";
import {
  DatabaseAuditRepository,
  checkDatabaseHealth,
} from "@opensaas/database";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { contactsRouter } from "./routes/contacts";
import { registrationRouter } from "./routes/registration";
import { createBranchesService } from "./services/branches.service";
import { createContactsService } from "./services/contacts.service";
import { createMembershipService } from "./services/membership.service";
import { createRegistrationService } from "./services/registration.service";
import type { AppEnv } from "./types";

/**
 * Dependencies of the HTTP surface (§4.7).
 *
 * Everything the app needs is injected: no module-level singletons are read
 * at request time, so a test can build an app bound to a specific
 * configuration and database handle.
 */
export type AppDependencies = {
  /** Validated configuration. */
  env: Env;
  /** Database handle used by the tenant-scoped routes. */
  db: Database;
  /** Better Auth instance: owns the `/api/auth/*` surface and session lookup. */
  auth: AuthInstance;
  /** Logger used by the error handler and the access log (§4.5). */
  logger: Logger;
};

/**
 * Build the HTTP application.
 *
 * The Better Auth handler is mounted on the whole `/api/auth/*` surface before
 * any custom route (§4.1), so the framework owns sign-up, sign-in, sign-out,
 * session and organization endpoints. The project-owned registration endpoint
 * lives outside that surface (`/api/registration`), which removes any possible
 * shadowing between the two.
 */
export const createApp = (dependencies: AppDependencies): Hono<AppEnv> => {
  const { env, db, auth, logger } = dependencies;
  const app = new Hono<AppEnv>();

  // The services are built once per app: the membership cache must survive
  // across requests, so it cannot be created per request (§4.3). The audit
  // port is the database-backed implementation, shared by every service that
  // mutates state (§4.4).
  const audit = new DatabaseAuditRepository(undefined, db);
  const branches = createBranchesService({ db });
  const services = {
    membership: createMembershipService({
      ttlSeconds: env.MEMBERSHIP_CACHE_TTL_S,
      audit,
      db,
    }),
    branches,
    contacts: createContactsService({ branches, audit, db }),
    registration: createRegistrationService({ env, audit, db }),
  };

  // Dependency-injection slots (§4.7): expose the validated config, the
  // database handle, the auth instance, the logger and the services on the
  // request context so downstream middleware/handlers read them from
  // `c.get(...)` instead of reaching for module globals. Registered before any
  // route so every request sees them.
  app.use("*", async (c, next) => {
    c.set("env", env);
    c.set("db", db);
    c.set("auth", auth);
    c.set("logger", logger);
    c.set("services", services);
    await next();
  });

  // Better Auth owns every `/api/auth/*` endpoint (§4.1): sign-up, sign-in,
  // sign-out, session, and the organization plugin endpoints.
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

  // Health check route (Liveness & Readiness)
  app.get("/api/health", async (c) => {
    // Read the DI slots rather than the module-level bindings, proving they are
    // consumed (no dead scaffolding, §4.7 AC4).
    const requestEnv = c.get("env");
    const database = c.get("db");
    const isDbConnected = await checkDatabaseHealth({ db: database });

    if (!isDbConnected) {
      logger.error("❌ Database health check failed: disconnected");
    }

    const statusCode = isDbConnected ? 200 : 503;

    return c.json(
      ok({
        status: isDbConnected ? "ok" : "degraded",
        environment: requestEnv.NODE_ENV,
        database: isDbConnected ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
      }),
      statusCode as ContentfulStatusCode,
    );
  });

  app.route("/api/registration", registrationRouter);
  app.route("/api/contacts", contactsRouter);

  // Unknown routes still answer with the JSON envelope instead of Hono's
  // plain-text default, keeping the response contract intact.
  app.notFound((c) => {
    const error = new NotFoundError("Route not found", { path: c.req.path });
    return c.json(fail(error), 404);
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      logger.warn({
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        details: err.details,
        path: c.req.path,
      });

      return c.json(fail(err), statusFromError(err) as ContentfulStatusCode);
    }

    logger.error(err, "Unhandled server error");

    // Unknown errors never leak internals: no details, generic message.
    return c.json(
      fail("INTERNAL_SERVER_ERROR", "An unexpected error occurred"),
      500,
    );
  });

  return app;
};
