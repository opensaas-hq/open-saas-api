import type { schema } from "@opensaas/database";
import { z } from "zod";
import { metadataSchema } from "./metadata";

/** A contact row as stored in the database. */
export type ContactRow = typeof schema.contacts.$inferSelect;

/** The default metadata payload of a contact. */
const EMPTY_METADATA: Record<string, unknown> = {};

/**
 * Narrow a `jsonb` column to a metadata record.
 *
 * The column is untyped (`jsonb` without a generic), so the value is `unknown`
 * at the type level: anything that is not a plain object becomes the empty
 * metadata instead of leaking into the response body.
 */
const toMetadataRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : EMPTY_METADATA;

/**
 * Request schema for creating a contact.
 *
 * It describes what a client may send, not what the database stores: the
 * tenant, the actor and the timestamps are never part of the request.
 */
export const createContactRequestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  branchId: z.uuid().optional(),
  status: z.enum(["active", "lead", "churned"]).default("active"),
  optIn: z.boolean().default(true),
  metadata: metadataSchema.prefault(EMPTY_METADATA),
});

/**
 * Build the request schema of the bulk import.
 *
 * The maximum number of contacts is a deployment knob (§4.5), so the schema
 * is built with it: a batch above the limit is rejected as a validation
 * failure before the transaction starts, and a single request can never
 * insert an unbounded number of rows.
 */
export const createBulkContactsRequestSchema = (maxContacts: number) =>
  z.object({
    contacts: z
      .array(createContactRequestSchema)
      .min(1, "At least one contact is required")
      .max(
        maxContacts,
        `At most ${maxContacts} contacts can be imported at once`,
      ),
  });

/** Query schema for listing contacts. */
export const contactsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["active", "lead", "churned"]).optional(),
  branchId: z.uuid().optional(),
  search: z.string().optional(),
});

/**
 * Schema of the `:id` path parameter of the contact routes.
 *
 * The id is validated before it reaches the service, so a malformed id is a
 * 422 instead of a database error.
 */
export const contactIdParamSchema = z.object({
  id: z.uuid("The contact id must be a uuid"),
});

/**
 * Request schema for updating a contact.
 *
 * Every field is optional: only the fields present in the request are
 * written, so a partial update never clears the others. The tenant, the
 * actor and the timestamps are never part of the request.
 */
export const updateContactRequestSchema = z
  .object({
    name: z.string().min(1, "Name is required").optional(),
    phone: z.string().nullable().optional(),
    email: z.email().nullable().optional(),
    branchId: z.uuid().nullable().optional(),
    status: z.enum(["active", "lead", "churned"]).optional(),
    optIn: z.boolean().optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

/**
 * Zod schema of a contact as the API returns it.
 *
 * The schema is the single source of the wire format: the TypeScript type is
 * inferred from it, and the generated OpenAPI document describes the same
 * shape, so the three cannot drift (§4.10).
 */
export const contactDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  branchId: z.string().nullable(),
  status: z.enum(["active", "lead", "churned"]),
  optIn: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A contact as the API returns it. */
export type ContactDto = z.infer<typeof contactDtoSchema>;

/** Pagination of a list response. */
export type PaginationDto = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/**
 * A create-contact request, as received: the defaults are still optional, so
 * the service decides what a missing field means.
 */
export type CreateContactRequest = z.input<typeof createContactRequestSchema>;

/** A create-contact request, parsed: every default is applied. */
export type ParsedCreateContactRequest = z.output<
  typeof createContactRequestSchema
>;

/**
 * An update-contact request, as received: every field is optional, so the
 * service decides which fields the request actually changes.
 */
export type UpdateContactRequest = z.input<typeof updateContactRequestSchema>;

/**
 * Map a contact row to its API representation.
 *
 * The mapper is the only place where a database row becomes a response body,
 * so the wire format is explicit and independent of the table layout.
 */
export const toContactDto = (row: ContactRow): ContactDto => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  branchId: row.branchId,
  status: row.status,
  optIn: row.optIn,
  metadata: toMetadataRecord(row.metadata),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
