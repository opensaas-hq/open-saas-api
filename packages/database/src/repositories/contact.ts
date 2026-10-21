import { and, count, eq, or, sql } from "drizzle-orm";
import { type Database, type Transaction, runInTenantContext } from "../client";
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
  /** Handle to run the write on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/** Options for {@link createContactsBulk}: one tenant for the whole batch. */
export type CreateContactsBulkOptions = {
  organizationId: string;
  contacts: ContactInput[];
  tx?: Transaction;
  /** Handle to run the write on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
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
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/** Options for {@link getContactById}: the tenant is required. */
export type GetContactByIdOptions = {
  organizationId: string;
  id: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/** The fields a contact may be updated with. */
export type ContactUpdate = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  branchId?: string | null;
  status?: ContactStatus;
  optIn?: boolean;
  metadata?: Record<string, unknown>;
};

/** Options for {@link updateContact}: the tenant scopes the update. */
export type UpdateContactOptions = ContactUpdate & {
  organizationId: string;
  id: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/** Options for {@link deleteContact}: the tenant scopes the delete. */
export type DeleteContactOptions = {
  organizationId: string;
  id: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * List contacts for one organization. `organizationId` is required and always
 * applied in the `WHERE`, so a missing tenant is a type error, not a leak. Runs
 * with the tenant GUC set (§2.5.2), so RLS confirms the same scoping.
 */
export async function getContactsByOrganization(options: GetContactsOptions) {
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

  const { data, totalResult } = await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [data, totalResult] = await Promise.all([
        tx
          .select()
          .from(contacts)
          .where(whereClause)
          .limit(limit)
          .offset(offset),
        tx.select({ total: count() }).from(contacts).where(whereClause),
      ]);
      return { data, totalResult };
    },
  });

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

/**
 * Read one contact of one organization.
 *
 * The organization is part of the `WHERE`, so a contact of another tenant is
 * reported as missing instead of being returned: the lookup cannot be used to
 * probe another tenant's data. Runs with the tenant GUC set, so RLS confirms
 * the same scoping (§2.5).
 */
export async function getContactById(options: GetContactByIdOptions) {
  const rows = await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) =>
      await tx
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.id, options.id),
            eq(contacts.organizationId, options.organizationId),
          ),
        )
        .limit(1),
  });

  return rows[0];
}

/**
 * Update a contact, scoped by both id and organization so a caller can never
 * mutate another tenant's row. Only the fields present in the update are
 * written, so a partial update never clears the others. Runs with the tenant
 * GUC set.
 */
export async function updateContact(options: UpdateContactOptions) {
  const changes: Partial<typeof contacts.$inferInsert> = {};

  if (options.name !== undefined) changes.name = options.name;
  if (options.phone !== undefined) changes.phone = options.phone;
  if (options.email !== undefined) changes.email = options.email;
  if (options.branchId !== undefined) changes.branchId = options.branchId;
  if (options.status !== undefined) changes.status = options.status;
  if (options.optIn !== undefined) changes.optIn = options.optIn;
  if (options.metadata !== undefined) changes.metadata = options.metadata;

  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [contact] = await tx
        .update(contacts)
        .set(changes)
        .where(
          and(
            eq(contacts.id, options.id),
            eq(contacts.organizationId, options.organizationId),
          ),
        )
        .returning();

      return contact;
    },
  });
}

/**
 * Delete a contact, scoped by both id and organization. Returns the deleted
 * row, or `undefined` when nothing matched. Runs with the tenant GUC set.
 */
export async function deleteContact(options: DeleteContactOptions) {
  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [contact] = await tx
        .delete(contacts)
        .where(
          and(
            eq(contacts.id, options.id),
            eq(contacts.organizationId, options.organizationId),
          ),
        )
        .returning();

      return contact;
    },
  });
}

/** Insert a single contact for one organization, with the tenant GUC set. */
export async function createContact(options: CreateContactOptions) {
  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [newContact] = await tx
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
    },
  });
}

/**
 * Insert several contacts for one organization. Pass a `tx` to run the batch
 * inside a surrounding transaction (see `withTransaction`), so a mid-batch
 * failure rolls back every row. Runs with the tenant GUC set.
 */
export async function createContactsBulk(options: CreateContactsBulkOptions) {
  if (options.contacts.length === 0) return [];

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

  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) =>
      await tx.insert(contacts).values(valuesToInsert).returning(),
  });
}
