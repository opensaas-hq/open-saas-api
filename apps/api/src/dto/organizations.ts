import type { schema } from "@opensaas/database";
import { z } from "zod";

/** An organization row as stored in the database. */
export type OrganizationRow = typeof schema.organization.$inferSelect;

/**
 * Zod schema of an organization as the API returns it.
 *
 * The schema is the single source of the wire format: the TypeScript type is
 * inferred from it, so the three cannot drift (§4.10).
 */
export const organizationDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});

/** An organization as the API returns it. */
export type OrganizationDto = z.infer<typeof organizationDtoSchema>;

/** Map an organization row to its API representation. */
export const toOrganizationDto = (row: OrganizationRow): OrganizationDto => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  createdAt: row.createdAt.toISOString(),
});
