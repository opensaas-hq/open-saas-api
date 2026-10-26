import { NotFoundError } from "@opensaas/core";
import { type Database, getOrganizationById } from "@opensaas/database";
import { type OrganizationDto, toOrganizationDto } from "../dto/organizations";

/** Options of {@link OrganizationsService.getById}. */
export type GetOrganizationInput = {
  /** The organization resolved from the session; never taken from a request. */
  organizationId: string;
};

/** The organizations service: the only place that reads organizations. */
export type OrganizationsService = {
  /** Read the organization of the current tenant. */
  getById: (input: GetOrganizationInput) => Promise<OrganizationDto>;
};

/** Dependencies of {@link createOrganizationsService}. */
export type OrganizationsServiceDeps = {
  /** Handle the repository runs on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * Build the organizations service.
 *
 * The GraphQL layer exposes the active organization (§4.11); the lookup runs
 * through this service so the resolvers never touch a repository directly.
 */
export const createOrganizationsService = (
  deps: OrganizationsServiceDeps = {},
): OrganizationsService => {
  const getById: OrganizationsService["getById"] = async (input) => {
    const row = await getOrganizationById({
      id: input.organizationId,
      db: deps.db,
    });

    // A session pointing at an organization that no longer exists is treated
    // as a missing resource; the tenant middleware already proved membership.
    if (!row) {
      throw new NotFoundError("Organization not found", {
        organizationId: input.organizationId,
      });
    }

    return toOrganizationDto(row);
  };

  return { getById };
};
