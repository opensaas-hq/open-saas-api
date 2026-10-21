import { NotFoundError } from "@opensaas/core";
import { getBranchById } from "@opensaas/database";

/** Reads one branch of one organization. */
export type BranchLookup = (input: {
  organizationId: string;
  branchId: string;
}) => Promise<{ id: string } | undefined>;

/** The branch service used by the tenant middleware and the contact routes. */
export type BranchesService = {
  /**
   * Assert that a branch belongs to the organization.
   *
   * Throws a {@link NotFoundError} when the branch does not exist or belongs to
   * another organization: a cross-tenant branch is reported as missing, so the
   * response never reveals that the id exists somewhere else.
   */
  assertBelongsToOrganization: (input: {
    organizationId: string;
    branchId: string;
  }) => Promise<void>;
};

/** Dependencies of {@link createBranchesService}. */
export type BranchesServiceDeps = {
  /** Read one branch of one organization. Defaults to the repository. */
  lookup?: BranchLookup;
};

/**
 * Build the branch service.
 *
 * Branch ownership is a tenant rule, not a transport concern: the same check
 * runs for the branch of a request header, of a query string and of a request
 * body, so it lives in a service instead of being repeated per route (§4.3).
 */
export const createBranchesService = (
  deps: BranchesServiceDeps = {},
): BranchesService => {
  const lookup: BranchLookup =
    deps.lookup ??
    (async ({ organizationId, branchId }) =>
      await getBranchById({ organizationId, id: branchId }));

  const assertBelongsToOrganization: BranchesService["assertBelongsToOrganization"] =
    async ({ organizationId, branchId }) => {
      const branch = await lookup({ organizationId, branchId });

      if (!branch) {
        throw new NotFoundError("Branch not found", {
          organizationId,
          branchId,
        });
      }
    };

  return { assertBelongsToOrganization };
};
