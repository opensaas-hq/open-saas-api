import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type DestinationStream } from "pino";
import { type Env, getEnv } from "./config";
import { REDACT_PATHS } from "./redact";

/**
 * Per-request correlation context bound onto every log line emitted inside it.
 * The `request-id` middleware wires this in the API pipeline; everything in
 * between can read it via {@link getRequestContext}.
 */
export type RequestContext = {
  requestId: string;
  tenantId?: string;
  userId?: string;
  route?: string;
};

/** Async-local store holding the active {@link RequestContext}, if any. */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given context visible to all logs and nested async work. */
export const withRequestContext = <T>(
  context: RequestContext,
  fn: () => T,
): T => requestContextStorage.run(context, fn);

/** Read the active request context, or `undefined` outside a request. */
export const getRequestContext = (): RequestContext | undefined =>
  requestContextStorage.getStore();

/**
 * Build a logger from validated config. Pretty output in development, plain
 * JSON in production. Log level and environment come from the validated `env`
 * (never raw `process.env`), and sensitive fields are redacted everywhere.
 * Nothing is constructed at module load.
 *
 * `destination` is honored for tests that need to capture real serialized
 * output; production callers omit it and pino writes to stdout.
 */
export const createLogger = (env: Env, destination?: DestinationStream) => {
  const isDevelopment = env.NODE_ENV !== "production";

  return pino(
    {
      level: env.LOG_LEVEL,
      redact: {
        paths: REDACT_PATHS,
        censor: "[REDACTED]",
      },
      // Pretty transport cannot coexist with an injected destination.
      transport:
        isDevelopment && !destination
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                ignore: "pid,hostname",
                translateTime: "SYS:HH:MM:ss",
              },
            }
          : undefined,
    },
    destination,
  );
};

/** Logger type derived from the factory. */
export type Logger = ReturnType<typeof createLogger>;

let cachedLogger: Logger | undefined;
let overrideLogger: Logger | undefined;

/**
 * Wrap a pino logger so that reads inside a request context return a child
 * carrying the context as bindings. Outside a context the base logger is used,
 * preserving `logger.level` and other pino surface used by consumers.
 */
const bindRequestContext = (base: Logger): Logger => {
  const context = getRequestContext();

  if (!context) {
    return base;
  }

  // `tenantId`/`userId`/`route` are optional; drop undefined so they are not
  // emitted as nulls on every line.
  const bindings: Record<string, string> = { requestId: context.requestId };
  if (context.tenantId) bindings.tenantId = context.tenantId;
  if (context.userId) bindings.userId = context.userId;
  if (context.route) bindings.route = context.route;

  return base.child(bindings) as unknown as Logger;
};

/**
 * Resolve the effective base logger: an installed test override wins over the
 * lazily-created, memoized default.
 */
const resolveBaseLogger = (): Logger => {
  cachedLogger ??= createLogger(getEnv());
  return overrideLogger ?? cachedLogger;
};

/**
 * Logger for the current scope. Inside a request context it is a child bound to
 * the correlation ids; otherwise it is the base logger. Consumers use this.
 */
export const getLogger = (): Logger => bindRequestContext(resolveBaseLogger());

/**
 * Test seam: force the logger returned by {@link getLogger} / {@link getBaseLogger}.
 * Paired with {@link resetLogger}; avoids touching `process.env` to capture logs.
 */
export const setLogger = (logger: Logger): void => {
  overrideLogger = logger;
};

/** Restore the default (memoized) logger, discarding any override. */
export const resetLogger = (): void => {
  overrideLogger = undefined;
  cachedLogger = undefined;
};

/**
 * Logger usable outside request scope (boot, background jobs). Kept separate
 * from {@link getLogger} so callers are explicit when there is no context.
 */
export const getBaseLogger = (): Logger => resolveBaseLogger();
