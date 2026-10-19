import pino from "pino";
import { type Env, getEnv } from "./config";

/**
 * Build a logger from validated config. Pretty output in development, plain
 * JSON in production. Nothing is constructed at module load.
 */
export const createLogger = (env: Env) => {
  const isDevelopment = env.NODE_ENV !== "production";

  return pino({
    level: env.LOG_LEVEL,
    transport: isDevelopment
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "SYS:HH:MM:ss",
          },
        }
      : undefined,
  });
};

/** Logger type derived from the factory. */
type Logger = ReturnType<typeof createLogger>;

let cachedLogger: Logger | undefined;

/**
 * Lazily-created, memoized default logger. Injecting a fake for tests is not
 * supported yet; that seam will be added when the logger is reworked.
 */
export const getLogger = (): Logger => {
  cachedLogger ??= createLogger(getEnv());
  return cachedLogger;
};
