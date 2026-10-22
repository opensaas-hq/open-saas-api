import {
  PERMISSION_MATRIX,
  type Permission,
  assertRole,
} from "../middleware/rbac";
import type { GraphqlContext } from "./context";

/**
 * Enforce one permission of the matrix on a resolver (§4.11).
 *
 * GraphQL has a single endpoint instead of one route per operation, so the
 * guard cannot be a route middleware. It reuses the very same matrix and the
 * same denial as `requirePermission`, so a role that may not call the REST
 * route may not call the resolver either.
 */
export const authorize = (
  context: GraphqlContext,
  permission: Permission,
): void => {
  assertRole(context.tenant.role, PERMISSION_MATRIX[permission]);
};
