import { type ApiResponse, AppError, env, logger } from "@opensaas/core";
import { checkDatabaseHealth } from "@opensaas/database";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const app = new Hono();

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

// Global Error Handler
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json<ApiResponse<never>>(
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

  console.error("🔥 Unhandled Server Error:", err);
  return c.json<ApiResponse<never>>(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred on the server.",
      },
    },
    500,
  );
});

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};

logger.info(
  `🚀 Starting API server on port ${env.PORT} in ${env.NODE_ENV} mode...`,
);
