import type { MiddlewareHandler } from "hono";
import type { Lifecycle } from "../lifecycle";
import type { AppEnv } from "../types";

/**
 * Track the requests that are in flight, so the shutdown controller can wait
 * for them (§4.8).
 *
 * The tracker counts every request that reaches the pipeline, and the counter
 * is decremented in a `finally`: a request that fails still releases its slot,
 * so a failing request can never make the drain hang.
 */
export const createInFlightMiddleware = (
  lifecycle: Lifecycle,
): MiddlewareHandler<AppEnv> => {
  return async (_c, next) => {
    lifecycle.beginRequest();

    try {
      await next();
    } finally {
      lifecycle.endRequest();
    }
  };
};
