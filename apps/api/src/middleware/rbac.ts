import { ForbiddenError } from "@opensaas/core";
import type { MiddlewareHandler } from "hono";
import type { Role } from "../services/membership.service";
import type { AppEnv } from "../types";

/**
 * Permission matrix of the API (§4.3).
 *
 * | Operation                     | owner | admin | member |
 * | ----------------------------- | ----- | ----- | ------ |
 * | Read contacts                 | yes   | yes   | yes    |
 * | Create / update a contact     | yes   | yes   | yes    |
 * | Bulk import contacts          | yes   | yes   | no     |
 * | Delete a contact              | yes   | yes   | no     |
 * | Read branches                 | yes   | yes   | yes    |
 * | Manage branches               | yes   | yes   | no     |
 * | Manage members and roles      | yes   | no    | no     |
 *
 * The roles come from the `member.role` column, resolved by the tenant
 * middleware and attached to the tenant context. `requireRole` is the only
 * place a role is checked, so a route states its requirement in one line.
 */
export const PERMISSION_MATRIX = {
  "contacts:read": ["owner", "admin", "member"],
  "contacts:write": ["owner", "admin", "member"],
  "contacts:bulk": ["owner", "admin"],
  "contacts:delete": ["owner", "admin"],
  "branches:read": ["owner", "admin", "member"],
  "branches:write": ["owner", "admin"],
  "members:write": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

/** A permission of the matrix. */
export type Permission = keyof typeof PERMISSION_MATRIX;

/**
 * Assert that the role is one of the allowed ones.
 *
 * The single place the denial is built: `requireRole` uses it for the routes
 * and the GraphQL guards (§4.11) for the resolvers. A role that was not
 * resolved is denied: the check never assumes a default role.
 */
export const assertRole = (
  role: Role | undefined,
  allowed: readonly Role[],
): void => {
  if (!role || !allowed.includes(role)) {
    throw new ForbiddenError(
      "The current role is not allowed to perform this operation",
      { required: allowed, role: role ?? null },
    );
  }
};

/**
 * Guard a route with the roles allowed to perform it.
 *
 * The guard runs after the tenant middleware, so the tenant context already
 * carries the resolved role.
 */
export const requireRole = (...allowed: Role[]): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    assertRole(c.get("tenant").role, allowed);
    await next();
  };
};

/**
 * Guard a route with the roles the matrix grants for a permission.
 *
 * This is what routes use: the permission names the operation, and the matrix
 * stays the single place deciding which roles may perform it.
 */
export const requirePermission = (
  permission: Permission,
): MiddlewareHandler<AppEnv> => requireRole(...PERMISSION_MATRIX[permission]);

/**
 * True when the matrix grants the permission to the role.
 *
 * The pure predicate behind {@link requirePermission}. The GraphQL layer
 * (§4.11) has a single endpoint instead of one route per operation, so it
 * checks the same matrix from its resolvers instead of a route middleware;
 * the rule itself is never duplicated.
 */
export const hasPermission = (
  role: Role | undefined,
  permission: Permission,
): boolean =>
  role !== undefined &&
  (PERMISSION_MATRIX[permission] as readonly Role[]).includes(role);
