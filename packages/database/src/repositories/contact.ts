import { and, count, eq, or, sql } from "drizzle-orm";
import { type Transaction, db } from "../client";
import { type ContactStatus, contacts } from "../schema";
import { toContainsLikePattern } from "./like";

/** A single contact to insert, without the tenant (supplied at the top level). */
export type ContactInput = {
  branchId?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  status?: ContactStatus;
  optIn?: boolean;
  metadata?: Record<string, unknown>;
};

/** Options for {@link createContact}: the tenant is required. */
export type CreateContactOptions = ContactInput & {
  organizationId: string;
  tx?: Transaction;
};

/** Options for {@link createContactsBulk}: one tenant for the whole batch. */
export type CreateContactsBulkOptions = {
  organizationId: string;
  contacts: ContactInput[];
  tx?: Transaction;
};

/** Options for {@link getContactsByOrganization}: the tenant is required. */
export type GetContactsOptions = {
  organizationId: string;
  page?: number;
  limit?: number;
  status?: ContactStatus;
  branchId?: string;
  search?: string;
  tx?: Transaction;
};

/**
 * List contacts for one organization. `organizationId` is required and always
 * applied in the `WHERE`, so a missing tenant is a type error, not a leak.
 */
export async function getContactsByOrganization(options: GetContactsOptions) {
  const executor = options.tx ?? db;
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions = [eq(contacts.organizationId, options.organizationId)];

  if (options.status) {
    conditions.push(eq(contacts.status, options.status));
  }

  if (options.branchId) {
    conditions.push(eq(contacts.branchId, options.branchId));
  }

  if (options.search && options.search.trim() !== "") {
    const pattern = toContainsLikePattern(options.search.trim());
    // Escape user wildcards: `ESCAPE '\'` makes the backslashes from
    // `toContainsLikePattern` literal escapes rather than pattern characters.
    const searchCondition = or(
      sql`${contacts.name} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${contacts.email} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${contacts.phone} ILIKE ${pattern} ESCAPE '\\'`,
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const whereClause = and(...conditions);

  const [data, totalResult] = await Promise.all([
    executor
      .select()
      .from(contacts)
      .where(whereClause)
      .limit(limit)
      .offset(offset),
    executor.select({ total: count() }).from(contacts).where(whereClause),
  ]);

  const total = Number(totalResult[0]?.total ?? 0);

  return {
    items: data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/** Insert a single contact for one organization. */
export async function createContact(options: CreateContactOptions) {
  const executor = options.tx ?? db;

  const [newContact] = await executor
    .insert(contacts)
    .values({
      organizationId: options.organizationId,
      branchId: options.branchId || null,
      name: options.name,
      phone: options.phone || null,
      email: options.email || null,
      status: options.status || "active",
      optIn: options.optIn ?? true,
      metadata: options.metadata || {},
    })
    .returning();

  return newContact;
}

/**
 * Insert several contacts for one organization. Pass a `tx` to run the batch
 * inside a surrounding transaction (see `withTransaction`), so a mid-batch
 * failure rolls back every row.
 */
export async function createContactsBulk(options: CreateContactsBulkOptions) {
  if (options.contacts.length === 0) return [];

  const executor = options.tx ?? db;

  const valuesToInsert = options.contacts.map((data) => ({
    organizationId: options.organizationId,
    branchId: data.branchId || null,
    name: data.name,
    phone: data.phone || null,
    email: data.email || null,
    status: data.status || "active",
    optIn: data.optIn ?? true,
    metadata: data.metadata || {},
  }));

  return await executor.insert(contacts).values(valuesToInsert).returning();
}
