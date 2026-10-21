import { zValidator } from "@hono/zod-validator";
import { ok } from "@opensaas/core";
import { Hono } from "hono";
import { etag } from "hono/etag";
import {
  branchIdParamSchema,
  createBranchRequestSchema,
  updateBranchRequestSchema,
} from "../dto/branches";
import { validationHook } from "../dto/validation";
import { requirePermission } from "../middleware/rbac";
import { tenantContextMiddleware } from "../middleware/tenant";
import type { AppEnv } from "../types";

/**
 * Build the branches surface.
 *
 * The branches were part of the schema and of the service layer, but they had
 * no route: the schema and the API surface disagreed (§4.9). The routes below
 * close that gap, and they are pure HTTP adapters: the tenant scope, the
 * auditing and the error mapping live in the service and in the middleware.
 */
export const createBranchesRouter = (): Hono<AppEnv> => {
  const branchesRouter = new Hono<AppEnv>();

  branchesRouter.use("*", tenantContextMiddleware);

  // GET /api/branches
  //
  // The listing is cacheable: the response carries an ETag, so a client can
  // revalidate it with `If-None-Match` and get a 304 without the body (§4.9).
  branchesRouter.get(
    "/",
    etag(),
    requirePermission("branches:read"),
    async (c) => {
      const tenant = c.get("tenant");

      const branches = await c.get("services").branches.list({
        organizationId: tenant.organizationId,
      });

      return c.json(ok(branches));
    },
  );

  // POST /api/branches
  branchesRouter.post(
    "/",
    requirePermission("branches:write"),
    zValidator(
      "json",
      createBranchRequestSchema,
      validationHook("Invalid branch data"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const body = c.req.valid("json");

      const branch = await c.get("services").branches.create({
        organizationId: tenant.organizationId,
        actorId: user.id,
        name: body.name,
      });

      return c.json(ok(branch), 201);
    },
  );

  // PATCH /api/branches/:id
  branchesRouter.patch(
    "/:id",
    requirePermission("branches:write"),
    zValidator(
      "param",
      branchIdParamSchema,
      validationHook("Invalid branch id"),
    ),
    zValidator(
      "json",
      updateBranchRequestSchema,
      validationHook("Invalid branch data"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const branch = await c.get("services").branches.update({
        organizationId: tenant.organizationId,
        actorId: user.id,
        id,
        name: body.name,
      });

      return c.json(ok(branch));
    },
  );

  // DELETE /api/branches/:id
  branchesRouter.delete(
    "/:id",
    requirePermission("branches:write"),
    zValidator(
      "param",
      branchIdParamSchema,
      validationHook("Invalid branch id"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const { id } = c.req.valid("param");

      await c.get("services").branches.remove({
        organizationId: tenant.organizationId,
        actorId: user.id,
        id,
      });

      return c.json(ok({ id }));
    },
  );

  return branchesRouter;
};
