import type { schema } from "@opensaas/database";
import { z } from "zod";

/** A branch row as stored in the database. */
export type BranchRow = typeof schema.branches.$inferSelect;

/**
 * Request schema for creating a branch.
 *
 * The tenant is never part of the request: it comes from the session (§4.3).
 */
export const createBranchRequestSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
});

/**
 * Request schema for updating a branch.
 *
 * Only the name of a branch can be changed: the tenant and the identity of
 * the branch are immutable.
 */
export const updateBranchRequestSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Name is too long"),
});

/** Schema of the `:id` path parameter of the branch routes. */
export const branchIdParamSchema = z.object({
  id: z.uuid("The branch id must be a uuid"),
});

/**
 * Zod schema of a branch as the API returns it.
 *
 * The schema is the single source of the wire format: the TypeScript type is
 * inferred from it, and the generated OpenAPI document describes the same
 * shape, so the three cannot drift (§4.10).
 */
export const branchDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
});

/** A branch as the API returns it. */
export type BranchDto = z.infer<typeof branchDtoSchema>;

/**
 * Map a branch row to its API representation.
 *
 * The mapper is the only place where a database row becomes a response body,
 * so the wire format is explicit and independent of the table layout.
 */
export const toBranchDto = (row: BranchRow): BranchDto => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
});
