import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type DestinationStream } from "pino";
import { type Env, getEnv } from "./config";
import { redact } from "./redact";

/**
 * The writable stream a logger writes to. Re-exported so a consumer (e.g. a
 * test capturing the access log, §4.5) can build a destination without
 * depending on pino directly.
 */
export type { DestinationStream };

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
 * Resolve the pretty transport target.
 *
 * `pino-pretty` is a dev dependency of this package, so it is not resolvable
 * from the application that consumes the logger (bun installs the
 * dependencies of a package in its own tree). The target is therefore
 * resolved here, from the package that declares it, and the transport is
 * skipped when the resolution fails: a missing developer convenience must
 * never break the boot of the process.
 */
const resolvePrettyTransport = ():
  | { target: string; options: Record<string, unknown> }
  | undefined => {
  try {
    return {
      target: import.meta.resolve("pino-pretty"),
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "SYS:HH:MM:ss",
      },
    };
  } catch {
    return undefined;
  }
};

/**
 * Build a logger from validated config. Pretty output in development, plain
 * JSON in production and in tests. Log level and environment come from the
 * validated `env` (never raw `process.env`).
 *
 * The pretty transport is only enabled for `NODE_ENV="development"`: it is a
 * developer convenience, it is not installed in every workspace, and a test
 * run must never depend on a transport worker thread (§4.7).
 *
 * Sensitive fields are redacted with the shared, pure {@link redact} helper
 * applied in pino's `formatters.log` hook. Unlike pino's own `redact.paths`
 * (case-sensitive and limited to enumerated depths), the helper is
 * case-insensitive and recursive, so `Authorization`, `Set-Cookie`,
 * `req.headers.authorization` and nested payloads are all covered by one
 * mechanism — the same rules the audit diff reuses.
 *
 * `destination` is honored for tests that need to capture real serialized
 * output; production callers omit it and pino writes to stdout.
 */
export const createLogger = (env: Env, destination?: DestinationStream) => {
  const isDevelopment = env.NODE_ENV === "development";
  const pretty =
    isDevelopment && !destination ? resolvePrettyTransport() : undefined;

  return pino(
    {
      level: env.LOG_LEVEL,
      // Sanitize the merged log object (message + context bindings + payload)
      // before serialization. Context bindings such as `requestId` are not
      // sensitive, so they survive untouched.
      formatters: {
        log: (object: Record<string, unknown>) =>
          redact(object) as Record<string, unknown>,
      },
      // Pretty transport cannot coexist with an injected destination.
      transport: pretty,
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
 * Test seam: force the logger returned by {@link getLogger}.
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
