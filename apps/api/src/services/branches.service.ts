import {
  type AuditEvent,
  type AuditPort,
  NotFoundError,
  computeAuditDiff,
} from "@opensaas/core";
import {
  type Database,
  createBranch,
  deleteBranch,
  getBranchById,
  listBranches,
  updateBranch,
} from "@opensaas/database";
import { type BranchDto, toBranchDto } from "../dto/branches";

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
  /** Read one branch of one organization. */
  getById: (input: {
    organizationId: string;
    id: string;
  }) => Promise<BranchDto>;
  /** List the branches of one organization. */
  list: (input: { organizationId: string }) => Promise<BranchDto[]>;
  /** Create a branch and audit the change. */
  create: (input: {
    organizationId: string;
    actorId: string;
    name: string;
  }) => Promise<BranchDto>;
  /** Update a branch and audit the change. */
  update: (input: {
    organizationId: string;
    actorId: string;
    id: string;
    name: string;
  }) => Promise<BranchDto>;
  /** Delete a branch and audit the change. */
  remove: (input: {
    organizationId: string;
    actorId: string;
    id: string;
  }) => Promise<void>;
};

/** Dependencies of {@link createBranchesService}. */
export type BranchesServiceDeps = {
  /** Read one branch of one organization. Defaults to the repository. */
  lookup?: BranchLookup;
  /**
   * Sink for the audit events of the mutations.
   *
   * It is optional because the service is also used by the tenant middleware,
   * which only needs the ownership check; the app factory always injects it.
   */
  audit?: AuditPort;
  /**
   * Handle the repository runs on. Defaults to the process-global proxy; the
   * app factory injects its own handle (TD-35).
   */
  db?: Database;
};

/**
 * Build the branch service.
 *
 * Branch ownership is a tenant rule, not a transport concern: the same check
 * runs for the branch of a request header, of a query string and of a request
 * body, so it lives in a service instead of being repeated per route (§4.3).
 *
 * The service also owns the mutations of the branches (§4.9): they are tenant
 * scoped by the repository and audited like every other state change.
 */
export const createBranchesService = (
  deps: BranchesServiceDeps = {},
): BranchesService => {
  const lookup: BranchLookup =
    deps.lookup ??
    (async ({ organizationId, branchId }) =>
      await getBranchById({ organizationId, id: branchId, db: deps.db }));

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

  const getById: BranchesService["getById"] = async (input) => {
    const row = await getBranchById({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
    });

    // A branch of another tenant is reported as missing: the response never
    // confirms that the id exists somewhere else (§4.3).
    if (!row) {
      throw new NotFoundError("Branch not found", {
        organizationId: input.organizationId,
        branchId: input.id,
      });
    }

    return toBranchDto(row);
  };

  const list: BranchesService["list"] = async (input) => {
    const rows = await listBranches({
      organizationId: input.organizationId,
      db: deps.db,
    });

    return rows.map(toBranchDto);
  };

  const create: BranchesService["create"] = async (input) => {
    const row = await createBranch({
      organizationId: input.organizationId,
      name: input.name,
      db: deps.db,
    });

    const dto = toBranchDto(row);

    await deps.audit?.record(
      branchEvent({
        action: "branch.created",
        organizationId: input.organizationId,
        actorId: input.actorId,
        branch: dto,
      }),
    );

    return dto;
  };

  const update: BranchesService["update"] = async (input) => {
    // The previous state is read first, so the audit event carries the real
    // diff instead of the whole row.
    const previous = await getBranchById({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
    });

    if (!previous) {
      throw new NotFoundError("Branch not found", {
        organizationId: input.organizationId,
        branchId: input.id,
      });
    }

    const row = await updateBranch({
      organizationId: input.organizationId,
      id: input.id,
      name: input.name,
      db: deps.db,
    });

    if (!row) {
      throw new NotFoundError("Branch not found", {
        organizationId: input.organizationId,
        branchId: input.id,
      });
    }

    const dto = toBranchDto(row);

    await deps.audit?.record(
      branchEvent({
        action: "branch.updated",
        organizationId: input.organizationId,
        actorId: input.actorId,
        branch: dto,
        previous: toBranchDto(previous),
      }),
    );

    return dto;
  };

  const remove: BranchesService["remove"] = async (input) => {
    const previous = await getBranchById({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
    });

    if (!previous) {
      throw new NotFoundError("Branch not found", {
        organizationId: input.organizationId,
        branchId: input.id,
      });
    }

    const row = await deleteBranch({
      organizationId: input.organizationId,
      id: input.id,
      db: deps.db,
    });

    if (!row) {
      throw new NotFoundError("Branch not found", {
        organizationId: input.organizationId,
        branchId: input.id,
      });
    }

    await deps.audit?.record(
      branchEvent({
        action: "branch.deleted",
        organizationId: input.organizationId,
        actorId: input.actorId,
        branch: toBranchDto(row),
        previous: toBranchDto(previous),
      }),
    );
  };

  return {
    assertBelongsToOrganization,
    getById,
    list,
    create,
    update,
    remove,
  };
};

/** Build the audit event of a branch mutation. */
const branchEvent = (input: {
  action: string;
  organizationId: string;
  actorId: string;
  branch: BranchDto;
  /** The state before the mutation, when the event describes a change. */
  previous?: BranchDto;
}): AuditEvent => ({
  action: input.action,
  entityType: "branch",
  entityId: input.branch.id,
  actorId: input.actorId,
  organizationId: input.organizationId,
  changes: computeAuditDiff(input.previous ?? {}, input.branch),
  timestamp: new Date().toISOString(),
});
