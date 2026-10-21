import {
  AppError,
  NotFoundError,
  fail,
  getEnv,
  getLogger,
  initConfig,
  ok,
  statusFromError,
} from "@opensaas/core";
import { checkDatabaseHealth, db } from "@opensaas/database";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import type { AppEnv } from "./types";

// Explicit boot: validate configuration and abort with a report if it is
// missing or invalid. Must run before any config value is read.
initConfig();

// Derive local env/logger from the factories instead of importing singletons.
const env = getEnv();
const logger = getLogger();

const app = new Hono<AppEnv>();

// Dependency-injection slots (§4.7): expose the validated config and the
// database handle on the request context so downstream middleware/handlers read
// them from `c.get(...)` instead of reaching for module globals. Registered
// before any route so every request sees them.
app.use("*", async (c, next) => {
  c.set("env", env);
  c.set("db", db);
  await next();
});

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

app.route("/api/auth", authRouter);
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

logger.info(
  `🚀 Starting API server on port ${env.PORT} in ${env.NODE_ENV} mode...`,
);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};
