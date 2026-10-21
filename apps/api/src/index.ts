import { createAuth } from "@opensaas/auth";
import { getEnv, getLogger, initConfig } from "@opensaas/core";
import { db } from "@opensaas/database";
import { createApp } from "./app";

// Explicit boot: validate configuration and abort with a report if it is
// missing or invalid. Must run before any config value is read.
initConfig();

// Derive local env/logger from the factories instead of importing singletons.
const env = getEnv();
const logger = getLogger();

// The auth instance is built here and injected into the app (§4.7): nothing
// reads the environment at import time anymore.
const auth = createAuth(env, db);

const app = createApp({ env, db, auth, logger });

logger.info(
  `🚀 Starting API server on port ${env.PORT} in ${env.NODE_ENV} mode...`,
);

export default {
  port: Number(env.PORT),
  fetch: app.fetch,
};
