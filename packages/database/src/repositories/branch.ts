import { and, asc, eq } from "drizzle-orm";
import { type Transaction, db } from "../client";
import { branches } from "../schema";

/** Options for {@link listBranches}: the tenant is required. */
export type ListBranchesOptions = {
  organizationId: string;
  tx?: Transaction;
};

/** Options for {@link createBranch}: the tenant is required. */
export type CreateBranchOptions = {
  organizationId: string;
  name: string;
  tx?: Transaction;
};

/** Options for {@link updateBranch}: the tenant scopes the update. */
export type UpdateBranchOptions = {
  organizationId: string;
  id: string;
  name: string;
  tx?: Transaction;
};

/** Options for {@link deleteBranch}: the tenant scopes the delete. */
export type DeleteBranchOptions = {
  organizationId: string;
  id: string;
  tx?: Transaction;
};

/**
 * List branches for one organization. `organizationId` is required and always
 * applied in the `WHERE`.
 */
export async function listBranches(options: ListBranchesOptions) {
  const executor = options.tx ?? db;

  return await executor
    .select()
    .from(branches)
    .where(eq(branches.organizationId, options.organizationId))
    .orderBy(asc(branches.createdAt));
}

/** Create a branch for one organization. */
export async function createBranch(options: CreateBranchOptions) {
  const executor = options.tx ?? db;

  const [branch] = await executor
    .insert(branches)
    .values({
      organizationId: options.organizationId,
      name: options.name,
    })
    .returning();

  return branch;
}

/**
 * Update a branch, scoped by both id and organization so a caller can never
 * mutate another tenant's row.
 */
export async function updateBranch(options: UpdateBranchOptions) {
  const executor = options.tx ?? db;

  const [branch] = await executor
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
}

/**
 * Delete a branch, scoped by both id and organization. Returns the deleted row,
 * or `undefined` when nothing matched.
 */
export async function deleteBranch(options: DeleteBranchOptions) {
  const executor = options.tx ?? db;

  const [branch] = await executor
    .delete(branches)
    .where(
      and(
        eq(branches.id, options.id),
        eq(branches.organizationId, options.organizationId),
      ),
    )
    .returning();

  return branch;
}
