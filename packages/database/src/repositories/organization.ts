import { type Transaction, db } from "../client";
import { organization } from "../schema";

export interface CreateOrganizationInput {
  id: string;
  name: string;
  slug: string;
  createdAt?: Date;
  /**
   * An existing transaction to join. Lets a caller wrap organization creation
   * together with its member row (§3.1). `organization` is a framework table,
   * outside the RLS scope (§2.5), so no tenant GUC is set here.
   */
  tx?: Transaction;
}

/**
 * Creates a new organization in the database.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const executor = input.tx ?? db;

  const [newOrg] = await executor
    .insert(organization)
    .values({
      id: input.id,
      name: input.name,
      slug: input.slug,
      createdAt: input.createdAt ?? new Date(),
    })
    .returning();
  return newOrg;
}
