import pino from "pino";
import { env } from "./config";

const isDevelopment = env.NODE_ENV !== "production";

export const logger = pino({
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
