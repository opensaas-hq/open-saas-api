import { TooManyRequestsError } from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** HTTP methods that mutate state and are therefore rate limited. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Options of the write-endpoint rate limiter. */
export type WriteRateLimiterOptions = {
  /** Length of the window, in seconds. */
  windowSeconds: number;
  /** Maximum number of write requests allowed per window and client. */
  max: number;
  /** Clock seam, so a test can drive the window without waiting. */
  now?: () => number;
};

/** State of one client in the current window. */
type WindowState = {
  /** Requests counted in the current window. */
  count: number;
  /** Epoch milliseconds at which the window resets. */
  resetAt: number;
};

/**
 * Resolve the identity of the caller for rate-limiting purposes.
 *
 * The proxy headers are read in the same order as the auth telemetry
 * (§3.5): Cloudflare first, then the generic reverse-proxy headers. The
 * fallback keeps unrelated clients in the same bucket, which is the safe
 * direction: a shared bucket throttles more, never less.
 */
const resolveClientKey = (headers: Headers): string => {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return (
    headers.get("cf-connecting-ip")?.trim() ||
    forwarded ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
};

/**
 * Rate limiter for the write endpoints (§4.5).
 *
 * Better Auth already guards its own routes (§3.4); this limiter covers the
 * write surface of the project as well — registration and the CRM writes —
 * and it sits in front of the auth handler, so it also shields the
 * authentication endpoints from a flood of write requests.
 *
 * The budget is kept per client and per method, so a client may not spend the
 * whole budget of one endpoint on another one. The limiter runs before the
 * session is resolved (that is the order of the pipeline), so the client is
 * identified by its IP address.
 *
 * The counters live in the process memory: the limiter protects a single
 * instance. A multi-instance deployment would need a shared store, which is
 * out of the scope of this phase.
 */
export const createWriteRateLimiter = (
  options: WriteRateLimiterOptions,
): MiddlewareHandler<AppEnv> => {
  const now = options.now ?? Date.now;
  const windowMs = options.windowSeconds * 1000;
  const windows = new Map<string, WindowState>();

  return async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const currentTime = now();
    const key = `${c.req.method}:${resolveClientKey(c.req.raw.headers)}`;
    const state = windows.get(key);

    if (!state || state.resetAt <= currentTime) {
      windows.set(key, { count: 1, resetAt: currentTime + windowMs });
      await next();
      return;
    }

    if (state.count >= options.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.resetAt - currentTime) / 1000),
      );

      throw new TooManyRequestsError(
        "Too many write requests, please retry later",
        { limit: options.max, windowSeconds: options.windowSeconds },
        retryAfterSeconds,
      );
    }

    state.count += 1;

    // Keep the map bounded: expired entries are dropped once it grows.
    if (windows.size > 10_000) {
      for (const [entryKey, entry] of windows) {
        if (entry.resetAt <= currentTime) windows.delete(entryKey);
      }
    }

    await next();
  };
};
