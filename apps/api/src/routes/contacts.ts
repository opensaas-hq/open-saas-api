import { zValidator } from "@hono/zod-validator";
import { ok } from "@opensaas/core";
import { Hono } from "hono";
import {
  contactsQuerySchema,
  createBulkContactsRequestSchema,
  createContactRequestSchema,
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
  contactsRouter.get(
    "/",
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

  // POST /api/contacts
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

      const contact = await c.get("services").contacts.create({
        organizationId: tenant.organizationId,
        actorId: user.id,
        branchId: tenant.branchId,
        contact: body,
      });

      return c.json(ok(contact), 201);
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

      const contacts = await c.get("services").contacts.bulkCreate({
        organizationId: tenant.organizationId,
        actorId: user.id,
        branchId: tenant.branchId,
        contacts: body.contacts,
      });

      return c.json(ok({ count: contacts.length, contacts }), 201);
    },
  );

  return contactsRouter;
};
