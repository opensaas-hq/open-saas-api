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

/** A contact as the API returns it. */
export type ContactDto = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  branchId: string | null;
  status: "active" | "lead" | "churned";
  optIn: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

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
