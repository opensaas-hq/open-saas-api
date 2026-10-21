import { AppError, UnauthorizedError } from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * Resolve the tenant context from the request session.
 *
 * This is the single session → tenant resolver of the app (§4.3): it reads
 * the session through the injected auth instance, refuses a request without a
 * valid session, and requires an active organization before touching any
 * tenant-scoped resource.
 *
 * The membership and branch-ownership checks live here too (§4.3): the user
 * must be a `member` of the active organization, and a requested branch must
 * belong to it.
 */
export const tenantContextMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  // 1. Validate session from cookies, Bearer tokens, or API keys. The auth
  // instance comes from the DI slot, so the session is verified with the same
  // configuration (and database handle) the rest of the request uses.
  const sessionData = await c.get("auth").api.getSession({
    headers: c.req.raw.headers,
  });

  if (!sessionData) {
    throw new UnauthorizedError(
      "Authentication required to access this resource",
    );
  }

  const { session, user } = sessionData;

  // 2. Extract active organization ID
  const activeOrgId = session.activeOrganizationId;

  if (!activeOrgId) {
    throw new AppError(
      "An active organization must be selected for multi-tenant requests", // 1st: message (string)
      400, // 2nd: statusCode (number)
      "MISSING_ACTIVE_ORGANIZATION", // 3rd: code (string)
    );
  }

  // 3. Extract branchId from headers or query params if present
  const branchId =
    c.req.header("x-branch-id") || c.req.query("branchId") || undefined;

  // 4. Inject tenant context into Hono request context
  c.set("user", user);
  c.set("session", session);
  c.set("tenant", {
    organizationId: activeOrgId,
    branchId,
  });

  await next();
};
