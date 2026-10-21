import { zValidator } from "@hono/zod-validator";
import { ok } from "@opensaas/core";
import { Hono } from "hono";
import { etag } from "hono/etag";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  contactIdParamSchema,
  contactsQuerySchema,
  createBulkContactsRequestSchema,
  createContactRequestSchema,
  updateContactRequestSchema,
} from "../dto/contacts";
import { validationHook } from "../dto/validation";
import { requirePermission } from "../middleware/rbac";
import { tenantContextMiddleware } from "../middleware/tenant";
import type { AppEnv } from "../types";

/**
 * Dependencies of the contacts routes.
 */
export type ContactsRouterOptions = {
  /** Maximum number of contacts accepted in one bulk import (§4.5). */
  bulkMaxContacts: number;
};

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
 */
export const createContactsRouter = (
  options: ContactsRouterOptions,
): Hono<AppEnv> => {
  const contactsRouter = new Hono<AppEnv>();

  const bulkContactsRequestSchema = createBulkContactsRequestSchema(
    options.bulkMaxContacts,
  );

  contactsRouter.use("*", tenantContextMiddleware);

  // GET /api/contacts
  //
  // The listing is cacheable: the response carries an ETag, so a client that
  // already holds the list can revalidate it with `If-None-Match` and get a
  // 304 without the body (§4.9).
  contactsRouter.get(
    "/",
    etag(),
    zValidator(
      "query",
      contactsQuerySchema,
      validationHook("Invalid contact query parameters"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const query = c.req.valid("query");

      const result = await c.get("services").contacts.list({
        organizationId: tenant.organizationId,
        ...query,
      });

      return c.json(ok(result.items, result.pagination));
    },
  );

  // GET /api/contacts/:id
  contactsRouter.get(
    "/:id",
    requirePermission("contacts:read"),
    zValidator(
      "param",
      contactIdParamSchema,
      validationHook("Invalid contact id"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const { id } = c.req.valid("param");

      const contact = await c.get("services").contacts.getById({
        organizationId: tenant.organizationId,
        id,
      });

      return c.json(ok(contact));
    },
  );

  // POST /api/contacts
  //
  // The write accepts an `Idempotency-Key`: a retry of the same request
  // replays the original response instead of creating a second contact
  // (§4.9).
  contactsRouter.post(
    "/",
    zValidator(
      "json",
      createContactRequestSchema,
      validationHook("Invalid contact data"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const body = c.req.valid("json");
      const services = c.get("services");

      const result = await services.idempotency.execute({
        scope: `organization:${tenant.organizationId}`,
        endpoint: "POST /api/contacts",
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

      return c.json(ok(result.body), result.status as ContentfulStatusCode);
    },
  );

  // PATCH /api/contacts/:id
  contactsRouter.patch(
    "/:id",
    requirePermission("contacts:write"),
    zValidator(
      "param",
      contactIdParamSchema,
      validationHook("Invalid contact id"),
    ),
    zValidator(
      "json",
      updateContactRequestSchema,
      validationHook("Invalid contact data"),
    ),
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

      return c.json(ok(contact));
    },
  );

  // DELETE /api/contacts/:id
  //
  // Deleting a contact is reserved to the roles that can change a whole
  // tenant's dataset at once (§4.3 permission matrix).
  contactsRouter.delete(
    "/:id",
    requirePermission("contacts:delete"),
    zValidator(
      "param",
      contactIdParamSchema,
      validationHook("Invalid contact id"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const { id } = c.req.valid("param");

      await c.get("services").contacts.remove({
        organizationId: tenant.organizationId,
        actorId: user.id,
        id,
      });

      return c.json(ok({ id }));
    },
  );

  // POST /api/contacts/bulk
  //
  // Bulk import is reserved to the roles that can change a whole tenant's
  // dataset at once (§4.3 permission matrix).
  contactsRouter.post(
    "/bulk",
    requirePermission("contacts:bulk"),
    zValidator(
      "json",
      bulkContactsRequestSchema,
      validationHook("Invalid bulk contacts data"),
    ),
    async (c) => {
      const tenant = c.get("tenant");
      const user = c.get("user");
      const body = c.req.valid("json");
      const services = c.get("services");

      const result = await services.idempotency.execute({
        scope: `organization:${tenant.organizationId}`,
        endpoint: "POST /api/contacts/bulk",
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
        result.status as ContentfulStatusCode,
      );
    },
  );

  return contactsRouter;
};
