import { type ApiResponse, AppError, env, logger } from "@opensaas/core";
import { checkDatabaseHealth } from "@opensaas/database";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { contactsRouter } from "./routes/contacts";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Health check route (Liveness & Readiness)
app.get("/api/health", async (c) => {
  const isDbConnected = await checkDatabaseHealth();

  if (!isDbConnected) {
    logger.error("❌ Database health check failed: disconnected");
  }

  const statusCode = isDbConnected ? 200 : 503;

  return c.json(
    {
      success: isDbConnected,
      data: {
        status: isDbConnected ? "ok" : "degraded",
        environment: env.NODE_ENV,
        database: isDbConnected ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
      },
    },
    statusCode as ContentfulStatusCode,
  );
});

// Mount CRM routes
app.route("/api/contacts", contactsRouter);

app.onError((err, c) => {
  if (err instanceof AppError) {
    logger.warn({
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      details: err.details,
      path: c.req.path,
    });

    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.statusCode as ContentfulStatusCode,
    );
  }

  logger.error(err, "Unhandled server error");

  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
      },
    },
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
