import { and, count, eq, ilike, or } from "drizzle-orm";
import { type Transaction, db } from "./client";
import { contacts } from "./schema";

export type CreateContactInput = {
  organizationId: string;
  branchId?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  status?: string;
  optIn?: boolean;
  metadata?: Record<string, unknown>;
};

export type GetContactsOptions = {
  organizationId: string;
  page?: number;
  limit?: number;
  status?: string;
  branchId?: string;
  search?: string;
};

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
    const searchTerm = `%${options.search.trim()}%`;
    const searchCondition = or(
      ilike(contacts.name, searchTerm),
      ilike(contacts.email, searchTerm),
      ilike(contacts.phone, searchTerm),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const whereClause = and(...conditions);

  const [data, totalResult] = await Promise.all([
    db.select().from(contacts).where(whereClause).limit(limit).offset(offset),
    db.select({ total: count() }).from(contacts).where(whereClause),
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

export async function createContact(data: CreateContactInput) {
  const [newContact] = await db
    .insert(contacts)
    .values({
      organizationId: data.organizationId,
      branchId: data.branchId || null,
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      status: data.status || "active",
      optIn: data.optIn ?? true,
      metadata: data.metadata || {},
    })
    .returning();

  return newContact;
}

export async function createContactsBulk(
  contactsList: CreateContactInput[],
  tx?: Transaction,
) {
  if (contactsList.length === 0) return [];

  const executor = tx || db;

  const valuesToInsert = contactsList.map((data) => ({
    organizationId: data.organizationId,
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
