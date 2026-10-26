import { and, asc, eq } from "drizzle-orm";
import { type Database, type Transaction, runInTenantContext } from "../client";
import { branches } from "../schema";

/** Options for {@link listBranches}: the tenant is required. */
export type ListBranchesOptions = {
  organizationId: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-35). */
  db?: Database;
};

/** Options for {@link createBranch}: the tenant is required. */
export type CreateBranchOptions = {
  organizationId: string;
  name: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-35). */
  db?: Database;
};

/** Options for {@link updateBranch}: the tenant scopes the update. */
export type UpdateBranchOptions = {
  organizationId: string;
  id: string;
  name: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-35). */
  db?: Database;
};

/** Options for {@link deleteBranch}: the tenant scopes the delete. */
export type DeleteBranchOptions = {
  organizationId: string;
  id: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-35). */
  db?: Database;
};

/** Options for {@link getBranchById}: the tenant scopes the lookup. */
export type GetBranchByIdOptions = {
  organizationId: string;
  id: string;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-35). */
  db?: Database;
};

/**
 * Read one branch of one organization.
 *
 * The organization is part of the `WHERE`, so a branch of another tenant is
 * reported as missing instead of being returned: the caller cannot use this
 * lookup to probe another tenant's data. Runs with the tenant GUC set, so RLS
 * confirms the same scoping (§2.5).
 */
export async function getBranchById(options: GetBranchByIdOptions) {
  const rows = await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) =>
      await tx
        .select()
        .from(branches)
        .where(
          and(
            eq(branches.id, options.id),
            eq(branches.organizationId, options.organizationId),
          ),
        )
        .limit(1),
  });

  return rows[0];
}

/**
 * List branches for one organization. `organizationId` is required and always
 * applied in the `WHERE`; the query runs with the tenant GUC set (§2.5.2).
 */
export async function listBranches(options: ListBranchesOptions) {
  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) =>
      await tx
        .select()
        .from(branches)
        .where(eq(branches.organizationId, options.organizationId))
        .orderBy(asc(branches.createdAt)),
  });
}

/** Create a branch for one organization, with the tenant GUC set. */
export async function createBranch(options: CreateBranchOptions) {
  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [branch] = await tx
        .insert(branches)
        .values({
          organizationId: options.organizationId,
          name: options.name,
        })
        .returning();

      return branch;
    },
  });
}

/**
 * Update a branch, scoped by both id and organization so a caller can never
 * mutate another tenant's row. Runs with the tenant GUC set.
 */
export async function updateBranch(options: UpdateBranchOptions) {
  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [branch] = await tx
        .update(branches)
        .set({ name: options.name })
        .where(
          and(
            eq(branches.id, options.id),
            eq(branches.organizationId, options.organizationId),
          ),
        )
        .returning();

      return branch;
    },
  });
}

/**
 * Delete a branch, scoped by both id and organization. Returns the deleted row,
 * or `undefined` when nothing matched. Runs with the tenant GUC set.
 */
export async function deleteBranch(options: DeleteBranchOptions) {
  return await runInTenantContext({
    organizationId: options.organizationId,
    tx: options.tx,
    db: options.db,
    run: async (tx) => {
      const [branch] = await tx
        .delete(branches)
        .where(
          and(
            eq(branches.id, options.id),
            eq(branches.organizationId, options.organizationId),
          ),
        )
        .returning();

      return branch;
    },
  });
}
