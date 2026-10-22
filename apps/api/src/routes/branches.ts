import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { apiSuccessResponseSchema, ok } from "@opensaas/core";
import { etag } from "hono/etag";
import { z } from "zod";
import {
  branchDtoSchema,
  branchIdParamSchema,
  createBranchRequestSchema,
  updateBranchRequestSchema,
} from "../dto/branches";
import { validationHook } from "../dto/validation";
import { requirePermission } from "../middleware/rbac";
import { tenantContextMiddleware } from "../middleware/tenant";
import {
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationResponse,
} from "../openapi/responses";
import type { AppEnv } from "../types";

/** The body of a deletion: the identifier of the removed resource. */
const deletedBranchSchema = z.object({ id: z.uuid() });

/**
 * Build the branches surface.
 *
 * The branches were part of the schema and of the service layer, but they had
 * no route: the schema and the API surface disagreed (§4.9). The routes below
 * close that gap, and they are pure HTTP adapters: the tenant scope, the
 * auditing and the error mapping live in the service and in the middleware.
 *
 * Every route is declared with `createRoute`, so the request schemas and the
 * documented responses are the very same objects the runtime uses (§4.10).
 */
export const createBranchesRouter = (): OpenAPIHono<AppEnv> => {
  const branchesRouter = new OpenAPIHono<AppEnv>();

  branchesRouter.use("*", tenantContextMiddleware);

  // GET /api/v1/branches
  //
  // The listing is cacheable: the response carries an ETag, so a client can
  // revalidate it with `If-None-Match` and get a 304 without the body (§4.9).
  const listBranchesRoute = createRoute({
    method: "get",
    path: "/",
    middleware: [etag(), requirePermission("branches:read")],
    responses: {
      200: {
        description: "The branches of the tenant",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(z.array(branchDtoSchema)),
          },
        },
      },
      401: unauthorizedResponse,
      403: forbiddenResponse,
      500: internalErrorResponse,
    },
  });

  branchesRouter.openapi(listBranchesRoute, async (c) => {
    const tenant = c.get("tenant");

    const branches = await c.get("services").branches.list({
      organizationId: tenant.organizationId,
    });

    return c.json(ok(branches), 200);
  });

  // POST /api/v1/branches
  const createBranchRoute = createRoute({
    method: "post",
    path: "/",
    middleware: [requirePermission("branches:write")],
    request: {
      body: {
        content: { "application/json": { schema: createBranchRequestSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The created branch",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(branchDtoSchema),
          },
        },
      },
      401: unauthorizedResponse,
      403: forbiddenResponse,
      422: validationResponse,
      500: internalErrorResponse,
    },
  });

  branchesRouter.openapi(
    createBranchRoute,
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
    validationHook("Invalid branch data"),
  );

  // PATCH /api/v1/branches/:id
  const updateBranchRoute = createRoute({
    method: "patch",
    path: "/{id}",
    middleware: [requirePermission("branches:write")],
    request: {
      params: branchIdParamSchema,
      body: {
        content: { "application/json": { schema: updateBranchRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The updated branch",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(branchDtoSchema),
          },
        },
      },
      401: unauthorizedResponse,
      403: forbiddenResponse,
      404: notFoundResponse,
      422: validationResponse,
      500: internalErrorResponse,
    },
  });

  branchesRouter.openapi(
    updateBranchRoute,
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

      return c.json(ok(branch), 200);
    },
    validationHook("Invalid branch data"),
  );

  // DELETE /api/v1/branches/:id
  const deleteBranchRoute = createRoute({
    method: "delete",
    path: "/{id}",
    middleware: [requirePermission("branches:write")],
    request: {
      params: branchIdParamSchema,
    },
    responses: {
      200: {
        description: "The deleted branch",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(deletedBranchSchema),
          },
        },
      },
      401: unauthorizedResponse,
      403: forbiddenResponse,
      404: notFoundResponse,
      422: validationResponse,
      500: internalErrorResponse,
    },
  });

  branchesRouter.openapi(
    deleteBranchRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const { id } = c.req.valid("param");

      await c.get("services").branches.remove({
        organizationId: tenant.organizationId,
        actorId: user.id,
        id,
      });

      return c.json(ok({ id }), 200);
    },
    validationHook("Invalid branch id"),
  );

  return branchesRouter;
};
