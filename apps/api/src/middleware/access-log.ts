import { AppError, type Logger, getRequestContext } from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** Options of the access log middleware. */
export type AccessLogOptions = {
  /** Logger the line is written to. Injected, never a module global (§4.7). */
  logger: Logger;
};

/**
 * Read the route pattern matched by the request, if any.
 *
 * The pattern (e.g. `/api/contacts/:id`) is what makes the log aggregatable;
 * it is unavailable for a request that matched no route, e.g. a 404.
 */
const resolveRoutePath = (c: { req: { routePath: string } }):
  | string
  | undefined => {
  try {
    return c.req.routePath;
  } catch {
    return undefined;
  }
};

/**
 * Resolve the status an error will produce.
 *
 * The error handler of the app turns the error into the response, so the
 * access log has to read the status from the error itself: a rate-limited
 * request answers 429, not 500.
 */
const resolveErrorStatus = (error: unknown): number => {
  if (error instanceof AppError) return error.statusCode;

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }

  return 500;
};

/**
 * Emit exactly one structured access-log line per request (§4.5, §5.6).
 *
 * The line carries the method, the path, the matched route, the status, the
 * duration, the request id and — once the tenant middleware has resolved them
 * — the tenant and the user. It never carries a body, a query string, a
 * header or any other personal data: only identifiers and timings, so the log
 * can be shipped and retained without becoming a data source.
 *
 * The logger is injected, so a test can capture the serialized output and
 * assert on it.
 */
export const createAccessLogMiddleware = (
  options: AccessLogOptions,
): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const startedAt = performance.now();
    let status = 500;

    try {
      await next();
      status = c.res.status;
    } catch (error) {
      status = resolveErrorStatus(error);
      throw error;
    } finally {
      const context = getRequestContext();

      options.logger.info(
        {
          requestId: context?.requestId,
          tenantId: context?.tenantId,
          userId: context?.userId,
          method: c.req.method,
          // The pathname only: a query string may carry personal data.
          path: new URL(c.req.url).pathname,
          route: resolveRoutePath(c),
          status,
          durationMs: Math.round(performance.now() - startedAt),
        },
        "request completed",
      );
    }
  };
};
