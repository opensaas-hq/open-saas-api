import { AppError, UnauthorizedError, ValidationError } from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";

/** Schema of the branch reference carried by a request. */
const branchIdSchema = z.uuid();

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
 * belong to it. Both complement the database-level isolation of RLS (§2.5):
 * the HTTP layer decides what a caller may ask for, the database layer
 * guarantees the rows it may see.
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

  // 3. Membership check: the user must belong to the active organization. A
  // session pointing at another organization is a tenant escalation attempt,
  // not a missing resource, so it is refused with 403.
  const role = await c.get("services").membership.getRole({
    userId: user.id,
    organizationId: activeOrgId,
  });

  if (!role) {
    throw new AppError(
      "The user is not a member of the active organization",
      403, // statusCode
      "NOT_A_MEMBER", // code
      { organizationId: activeOrgId },
    );
  }

  // 4. Extract branchId from headers or query params if present
  const branchId =
    c.req.header("x-branch-id") || c.req.query("branchId") || undefined;

  // 5. Branch ownership: the branch must belong to the active organization.
  // A branch of another tenant is reported as missing (404), so the response
  // never confirms that the id exists somewhere else.
  if (branchId) {
    const parsed = branchIdSchema.safeParse(branchId);

    if (!parsed.success) {
      throw new ValidationError("Invalid branch id", {
        field: "branchId",
        code: "INVALID_BRANCH_ID",
      });
    }

    await c.get("services").branches.assertBelongsToOrganization({
      organizationId: activeOrgId,
      branchId: parsed.data,
    });
  }

  // 6. Inject tenant context into Hono request context
  c.set("user", user);
  c.set("session", session);
  c.set("tenant", {
    organizationId: activeOrgId,
    branchId,
    role,
  });

  await next();
};
