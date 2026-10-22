import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { apiSuccessResponseSchema, ok } from "@opensaas/core";
import { etag } from "hono/etag";
import { z } from "zod";
import {
  contactDtoSchema,
  contactIdParamSchema,
  contactsQuerySchema,
  createBulkContactsRequestSchema,
  createContactRequestSchema,
  updateContactRequestSchema,
} from "../dto/contacts";
import { validationHook } from "../dto/validation";
import { requirePermission } from "../middleware/rbac";
import { tenantContextMiddleware } from "../middleware/tenant";
import {
  conflictResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  rateLimitResponse,
  unauthorizedResponse,
  validationResponse,
} from "../openapi/responses";
import type { AppEnv } from "../types";

/**
 * Dependencies of the contacts routes.
 */
export type ContactsRouterOptions = {
  /** Maximum number of contacts accepted in one bulk import (§4.5). */
  bulkMaxContacts: number;
};

/** The body of a bulk import: how many contacts were created, and which. */
const bulkContactsResultSchema = z.object({
  count: z.number().int().nonnegative(),
  contacts: z.array(contactDtoSchema),
});

/** The body of a deletion: the identifier of the removed resource. */
const deletedContactSchema = z.object({ id: z.uuid() });

/**
 * Build the contacts surface.
 *
 * The routes are pure HTTP adapters: they parse the request, call the
 * contacts service and serialize the envelope. Every rule — tenancy, branch
 * ownership, transactions and auditing — lives in the service (§4.4).
 *
 * The router is built per application because the bulk limit is a deployment
 * knob (§4.5): the schema carries the configured maximum, so an oversized
 * batch is refused before any transaction is started.
 *
 * Every route is declared with `createRoute`, so the request schemas and the
 * documented responses are the very same objects the runtime uses (§4.10).
 */
export const createContactsRouter = (
  options: ContactsRouterOptions,
): OpenAPIHono<AppEnv> => {
  const contactsRouter = new OpenAPIHono<AppEnv>();

  const bulkContactsRequestSchema = createBulkContactsRequestSchema(
    options.bulkMaxContacts,
  );

  contactsRouter.use("*", tenantContextMiddleware);

  // GET /api/v1/contacts
  //
  // The listing is cacheable: the response carries an ETag, so a client that
  // already holds the list can revalidate it with `If-None-Match` and get a
  // 304 without the body (§4.9).
  const listContactsRoute = createRoute({
    method: "get",
    path: "/",
    middleware: [etag()],
    request: {
      query: contactsQuerySchema,
    },
    responses: {
      200: {
        description: "The contacts of the tenant",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(z.array(contactDtoSchema), true),
          },
        },
      },
      401: unauthorizedResponse,
      422: validationResponse,
      500: internalErrorResponse,
    },
  });

  contactsRouter.openapi(
    listContactsRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const query = c.req.valid("query");

      const result = await c.get("services").contacts.list({
        organizationId: tenant.organizationId,
        ...query,
      });

      return c.json(ok(result.items, result.pagination), 200);
    },
    validationHook("Invalid contact query parameters"),
  );

  // GET /api/v1/contacts/:id
  const getContactRoute = createRoute({
    method: "get",
    path: "/{id}",
    middleware: [requirePermission("contacts:read")],
    request: {
      params: contactIdParamSchema,
    },
    responses: {
      200: {
        description: "The requested contact",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(contactDtoSchema),
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

  contactsRouter.openapi(
    getContactRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");

      const contact = await c.get("services").contacts.getById({
        organizationId: tenant.organizationId,
        id,
      });

      return c.json(ok(contact), 200);
    },
    validationHook("Invalid contact id"),
  );

  // POST /api/v1/contacts
  //
  // The write accepts an `Idempotency-Key`: a retry of the same request
  // replays the original response instead of creating a second contact
  // (§4.9).
  const createContactRoute = createRoute({
    method: "post",
    path: "/",
    request: {
      body: {
        content: { "application/json": { schema: createContactRequestSchema } },
        required: true,
      },
      headers: z.object({
        "idempotency-key": z.string().min(1).optional(),
      }),
    },
    responses: {
      201: {
        description: "The created contact",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(contactDtoSchema),
          },
        },
      },
      401: unauthorizedResponse,
      403: forbiddenResponse,
      409: conflictResponse,
      422: validationResponse,
      429: rateLimitResponse,
      500: internalErrorResponse,
    },
  });

  contactsRouter.openapi(
    createContactRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const body = c.req.valid("json");
      const services = c.get("services");

      const result = await services.idempotency.execute({
        scope: `organization:${tenant.organizationId}`,
        endpoint: "POST /api/v1/contacts",
        key: c.req.header("idempotency-key"),
        payload: {
          body,
          // The branch of the request is part of the request: the same key
          // with another branch is another request, not a replay.
          branchId: body.branchId ?? tenant.branchId ?? null,
        },
        operation: async () => ({
          status: 201,
          body: await services.contacts.create({
            organizationId: tenant.organizationId,
            actorId: user.id,
            branchId: tenant.branchId,
            contact: body,
          }),
        }),
      });

      if (result.replayed) {
        c.header("idempotent-replayed", "true");
      }

      // The operation always answers 201: the replay returns the stored body
      // of that very response.
      return c.json(ok(result.body), 201);
    },
    validationHook("Invalid contact data"),
  );

  // PATCH /api/v1/contacts/:id
  const updateContactRoute = createRoute({
    method: "patch",
    path: "/{id}",
    middleware: [requirePermission("contacts:write")],
    request: {
      params: contactIdParamSchema,
      body: {
        content: {
          "application/json": { schema: updateContactRequestSchema },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The updated contact",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(contactDtoSchema),
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

  contactsRouter.openapi(
    updateContactRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const contact = await c.get("services").contacts.update({
        organizationId: tenant.organizationId,
        actorId: user.id,
        id,
        contact: body,
      });

      return c.json(ok(contact), 200);
    },
    validationHook("Invalid contact data"),
  );

  // DELETE /api/v1/contacts/:id
  //
  // Deleting a contact is reserved to the roles that can change a whole
  // tenant's dataset at once (§4.3 permission matrix).
  const deleteContactRoute = createRoute({
    method: "delete",
    path: "/{id}",
    middleware: [requirePermission("contacts:delete")],
    request: {
      params: contactIdParamSchema,
    },
    responses: {
      200: {
        description: "The deleted contact",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(deletedContactSchema),
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

  contactsRouter.openapi(
    deleteContactRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const { id } = c.req.valid("param");

      await c.get("services").contacts.remove({
        organizationId: tenant.organizationId,
        actorId: user.id,
        id,
      });

      return c.json(ok({ id }), 200);
    },
    validationHook("Invalid contact id"),
  );

  // POST /api/v1/contacts/bulk
  //
  // Bulk import is reserved to the roles that can change a whole tenant's
  // dataset at once (§4.3 permission matrix).
  const bulkCreateContactsRoute = createRoute({
    method: "post",
    path: "/bulk",
    middleware: [requirePermission("contacts:bulk")],
    request: {
      body: {
        content: {
          "application/json": { schema: bulkContactsRequestSchema },
        },
        required: true,
      },
      headers: z.object({
        "idempotency-key": z.string().min(1).optional(),
      }),
    },
    responses: {
      201: {
        description: "The created contacts",
        content: {
          "application/json": {
            schema: apiSuccessResponseSchema(bulkContactsResultSchema),
          },
        },
      },
      401: unauthorizedResponse,
      403: forbiddenResponse,
      409: conflictResponse,
      422: validationResponse,
      429: rateLimitResponse,
      500: internalErrorResponse,
    },
  });

  contactsRouter.openapi(
    bulkCreateContactsRoute,
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const body = c.req.valid("json");
      const services = c.get("services");

      const result = await services.idempotency.execute({
        scope: `organization:${tenant.organizationId}`,
        endpoint: "POST /api/v1/contacts/bulk",
        key: c.req.header("idempotency-key"),
        payload: { body, branchId: tenant.branchId ?? null },
        operation: async () => ({
          status: 201,
          body: await services.contacts.bulkCreate({
            organizationId: tenant.organizationId,
            actorId: user.id,
            branchId: tenant.branchId,
            contacts: body.contacts,
          }),
        }),
      });

      if (result.replayed) {
        c.header("idempotent-replayed", "true");
      }

      return c.json(
        ok({ count: result.body.length, contacts: result.body }),
        201,
      );
    },
    validationHook("Invalid bulk contacts data"),
  );

  return contactsRouter;
};
