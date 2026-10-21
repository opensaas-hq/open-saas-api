import {
  type Env,
  type Logger,
  PayloadTooLargeError,
  fail,
  getTrustedOrigins,
} from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../types";
import { createAccessLogMiddleware } from "./access-log";
import { createWriteRateLimiter } from "./rate-limit";
import { requestIdMiddleware } from "./request-id";

/** Options of the HTTP pipeline. */
export type PipelineOptions = {
  /** Validated configuration: the CORS allowlist and the limits. */
  env: Env;
  /** Logger the access log writes to. */
  logger: Logger;
};

/**
 * Headers a browser is allowed to send to the API.
 *
 * The list mirrors what the API actually reads: the JSON content type, the
 * bearer token, the branch selector and the correlation id.
 */
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Branch-Id",
  "X-Request-Id",
];

/**
 * Build the cross-cutting middleware pipeline (§4.5).
 *
 * The order follows docs/v3/architecture.md §15.2 and is significant:
 *
 * 1. `request-id` — every later step and every log line can be correlated.
 * 2. access log — wraps the rest, so it observes the final status.
 * 3. `secureHeaders()` — the security headers are set on every response.
 * 4. CORS — the allowlist is applied before anything is executed.
 * 5. rate limit — cheap rejections happen before the body is read.
 * 6. body size limit — an oversized body is refused before it is parsed.
 *
 * The authentication (the Better Auth handler and the session lookup), the
 * tenant resolution (§4.3) and the RBAC check (§4.3) are mounted on the
 * routes themselves, after this pipeline, and the route validation closes the
 * chain.
 *
 * Wildcard escaping (§2.6) is not implemented here: it belongs to the
 * repository layer, where the `like`/`ilike` patterns are built. A validator
 * added to this pipeline must not build a `like` pattern on its own, or it
 * would bypass the escaping the repositories guarantee.
 */
export const createPipeline = (
  options: PipelineOptions,
): MiddlewareHandler<AppEnv>[] => {
  const { env, logger } = options;
  // The very same allowlist Better Auth uses for its own origin check (§3.4):
  // one source of truth, so a browser accepted by the auth surface is
  // accepted by the API surface too.
  const trustedOrigins = getTrustedOrigins(env);

  return [
    requestIdMiddleware,
    createAccessLogMiddleware({ logger }),
    secureHeaders(),
    cors({
      // Only the configured origins are echoed back: an unknown origin gets no
      // `access-control-allow-origin` header and the browser blocks it.
      origin: (origin) => (trustedOrigins.includes(origin) ? origin : null),
      allowMethods: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ],
      allowHeaders: ALLOWED_HEADERS,
      exposeHeaders: ["X-Request-Id"],
      credentials: true,
      maxAge: 600,
    }),
    ...(env.WRITE_RATE_LIMIT_ENABLED
      ? [
          createWriteRateLimiter({
            windowSeconds: env.WRITE_RATE_LIMIT_WINDOW_S,
            max: env.WRITE_RATE_LIMIT_MAX,
          }),
        ]
      : []),
    bodyLimit({
      maxSize: env.BODY_SIZE_LIMIT_BYTES,
      onError: (c) =>
        c.json(
          fail(
            new PayloadTooLargeError("Request body is too large", {
              limitBytes: env.BODY_SIZE_LIMIT_BYTES,
            }),
          ),
          413,
        ),
    }),
  ];
};
