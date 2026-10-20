import { ValidationError } from "@opensaas/core";
import {
  createContact,
  createContactsBulk,
  getContactsByOrganization,
} from "@opensaas/database";
import { Hono } from "hono";
import { z } from "zod";
import { tenantContextMiddleware } from "../middleware/tenant";
import type { AppEnv } from "../types";

const contactsRouter = new Hono<AppEnv>();

contactsRouter.use("*", tenantContextMiddleware);

/** Request schema for creating a contact. Exported for direct unit testing. */
export const createContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  branchId: z.uuid().optional(),
  status: z.enum(["active", "lead", "churned"]).default("active"),
  optIn: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/** Query schema for listing contacts. Exported for direct unit testing. */
export const contactsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["active", "lead", "churned"]).optional(),
  branchId: z.uuid().optional(),
  search: z.string().optional(),
});

// GET /api/contacts
contactsRouter.get("/", async (c) => {
  const tenant = c.get("tenant");
  const query = contactsQuerySchema.parse(c.req.query());

  const result = await getContactsByOrganization({
    organizationId: tenant.organizationId,
    ...query,
  });

  return c.json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
});

// POST /api/contacts
contactsRouter.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = await c.req.json();

  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid contact data", parsed.error.format());
  }

  const newContact = await createContact({
    ...parsed.data,
    organizationId: tenant.organizationId,
    branchId: parsed.data.branchId || tenant.branchId,
  });

  return c.json(
    {
      success: true,
      data: newContact,
    },
    201,
  );
});

// POST /api/contacts/bulk
const bulkContactSchema = z.object({
  contacts: z
    .array(createContactSchema)
    .min(1, "At least one contact is required"),
});

contactsRouter.post("/bulk", async (c) => {
  const tenant = c.get("tenant");
  const body = await c.req.json();

  const parsed = bulkContactSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      "Invalid bulk contacts data",
      parsed.error.format(),
    );
  }

  const contactsToInsert = parsed.data.contacts.map((item) => ({
    ...item,
    organizationId: tenant.organizationId,
    branchId: item.branchId || tenant.branchId,
  }));

  const insertedContacts = await createContactsBulk(contactsToInsert);

  return c.json(
    {
      success: true,
      data: {
        count: insertedContacts.length,
        contacts: insertedContacts,
      },
    },
    201,
  );
});

export { contactsRouter };
