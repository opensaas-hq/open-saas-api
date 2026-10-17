import { logger } from "@opensaas/core";
import { db } from "@opensaas/database";
import { Hono } from "hono";
import { env } from "./config";

const app = new Hono();

// Health check route
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

logger.info(
  `🚀 Starting API server on port ${env.PORT} in ${env.NODE_ENV} mode...`,
);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};
