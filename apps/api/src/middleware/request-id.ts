import { type RequestContext, withRequestContext } from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** Header carrying the correlation id of a request. */
const REQUEST_ID_HEADER = "x-request-id";

/** Maximum length of an inbound request id that is trusted as-is. */
const MAX_REQUEST_ID_LENGTH = 64;

/**
 * Characters accepted in an inbound request id.
 *
 * The id is echoed back in a response header and written to every log line,
 * so anything that could forge a log entry or inject a header is rejected and
 * replaced by a freshly generated id.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Resolve the correlation id of a request.
 *
 * A client-provided id is honoured when it is short and made of safe
 * characters, so a caller can correlate its own traces with ours. Anything
 * else is discarded and replaced by a random UUID: the id ends up in a
 * response header and in the logs, and both must not be forgeable.
 */
const resolveRequestId = (incoming: string | undefined): string => {
  if (
    incoming !== undefined &&
    incoming.length > 0 &&
    incoming.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(incoming)
  ) {
    return incoming;
  }

  return crypto.randomUUID();
};

/**
 * Assign a correlation id to every request and open the request context
 * (§1.4).
 *
 * The context is stored in an `AsyncLocalStorage`, so every log line and every
 * nested async call of the request sees the same id without threading it
 * through the call stack. The tenant middleware enriches the context with the
 * tenant and the user once they are known, and the access log (§4.5) reads
 * them back when the response is ready.
 *
 * The id is also echoed in the `x-request-id` response header, so a client can
 * quote it when reporting a problem.
 */
export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));

  c.header(REQUEST_ID_HEADER, requestId);

  const context: RequestContext = { requestId };

  await withRequestContext(context, async () => {
    await next();
  });
};
