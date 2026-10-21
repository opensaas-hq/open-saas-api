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
  "branches:write": ["owner", "admin"],
  "members:write": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

/** A permission of the matrix. */
export type Permission = keyof typeof PERMISSION_MATRIX;

/**
 * Guard a route with the roles allowed to perform it.
 *
 * The guard runs after the tenant middleware, so the tenant context already
 * carries the resolved role. A request without a resolved role is denied: the
 * guard never assumes a default role.
 */
export const requireRole = (...allowed: Role[]): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const role = c.get("tenant").role;

    if (!role || !allowed.includes(role)) {
      throw new ForbiddenError(
        "The current role is not allowed to perform this operation",
        { required: allowed, role: role ?? null },
      );
    }

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
