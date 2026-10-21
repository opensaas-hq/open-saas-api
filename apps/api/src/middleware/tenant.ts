import { auth } from "@opensaas/auth";
import { AppError, UnauthorizedError } from "@opensaas/core";
import type { Context, Next } from "hono";

export async function tenantContextMiddleware(c: Context, next: Next) {
  // 1. Validate session from cookies, Bearer tokens, or API keys
  const sessionData = await auth.api.getSession({
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
}
