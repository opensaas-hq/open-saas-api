import { db } from "../client";
import { organization } from "../schema";

export interface CreateOrganizationInput {
  id: string;
  name: string;
  slug: string;
  createdAt?: Date;
}

/**
 * Creates a new organization in the database.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  const [newOrg] = await db
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
