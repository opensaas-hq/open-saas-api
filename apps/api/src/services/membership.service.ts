import { type AuditPort, computeAuditDiff } from "@opensaas/core";
import {
  type Database,
  getMemberRole,
  removeMember,
  updateMemberRole,
} from "@opensaas/database";

/**
 * The roles a member can hold in an organization. The values match the ones
 * the Better Auth organization plugin writes in the `member.role` column.
 */
export const ROLES = ["owner", "admin", "member"] as const;

/** A role inside an organization. */
export type Role = (typeof ROLES)[number];

/** The membership of one user in one organization. */
export type Membership = {
  organizationId: string;
  userId: string;
  role: Role;
};

/** Reads the role of a user in an organization. */
export type MembershipLookup = (input: {
  userId: string;
  organizationId: string;
}) => Promise<string | undefined>;

/** Writes the role of a user in an organization. */
export type MembershipUpdate = (input: {
  userId: string;
  organizationId: string;
  role: string;
}) => Promise<void>;

/** The membership service used by the tenant middleware and the RBAC guard. */
export type MembershipService = {
  /**
   * Resolve the role of a user in an organization, or `undefined` when the
   * user is not a member. The result is cached for the configured TTL.
   */
  getRole: (input: {
    userId: string;
    organizationId: string;
  }) => Promise<Role | undefined>;
  /**
   * Drop the cached role of one membership. Called after every write that can
   * change it, so the next lookup observes the new value immediately.
   */
  invalidate: (input: { userId: string; organizationId: string }) => void;
  /**
   * Change the role of a member and invalidate its cached value.
   */
  setRole: (input: {
    userId: string;
    organizationId: string;
    role: Role;
    /** The user performing the change; recorded in the audit event. */
    actorId: string;
  }) => Promise<void>;
  /**
   * Remove a membership and invalidate its cached value.
   */
  removeMembership: (input: {
    userId: string;
    organizationId: string;
    /** The user performing the change; recorded in the audit event. */
    actorId: string;
  }) => Promise<void>;
};

/** Dependencies of {@link createMembershipService}. */
export type MembershipServiceDeps = {
  /** How long a resolved role stays cached, in seconds. `0` disables caching. */
  ttlSeconds: number;
  /** Read the role of a membership. Defaults to the repository. */
  lookup?: MembershipLookup;
  /** Write the role of a membership. Defaults to the repository. */
  update?: MembershipUpdate;
  /** Clock used to stamp the cache entries. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Sink for the audit events of the membership changes. Optional: a service
   * built without one simply does not audit.
   */
  audit?: AuditPort;
  /**
   * Handle the repository runs on. Defaults to the process-global proxy; the
   * app factory injects its own handle (TD-23).
   */
  db?: Database;
};

/**
 * Narrow a raw role to a known one.
 *
 * A role the application does not know about is treated as "no membership":
 * the request is denied instead of being authorized with an unverified role.
 */
const asRole = (value: string | undefined): Role | undefined =>
  value !== undefined && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : undefined;

/**
 * Build the membership service.
 *
 * The service is the single place that answers "what is the role of this user
 * in this organization" (§4.3). Results are cached for `ttlSeconds` because
 * the tenant middleware runs on every tenant-scoped request and the `member`
 * table is read on each of them otherwise.
 *
 * The cache is invalidated explicitly on every write the service performs, and
 * a role changed outside the service stays stale for at most the TTL — that
 * bound is the documented cost of the cache.
 */
export const createMembershipService = (
  deps: MembershipServiceDeps,
): MembershipService => {
  const now = deps.now ?? Date.now;
  const lookup: MembershipLookup =
    deps.lookup ??
    (async ({ userId, organizationId }) =>
      await getMemberRole({ userId, organizationId, db: deps.db }));
  const update: MembershipUpdate =
    deps.update ??
    (async ({ userId, organizationId, role }) => {
      await updateMemberRole({ userId, organizationId, role, db: deps.db });
    });

  const cache = new Map<string, { role: Role; expiresAt: number }>();
  const cacheKey = (userId: string, organizationId: string) =>
    `${organizationId}:${userId}`;

  const getRole: MembershipService["getRole"] = async ({
    userId,
    organizationId,
  }) => {
    const key = cacheKey(userId, organizationId);
    const cached = cache.get(key);

    if (cached && cached.expiresAt > now()) {
      return cached.role;
    }

    const role = asRole(await lookup({ userId, organizationId }));

    if (!role) {
      cache.delete(key);
      return undefined;
    }

    if (deps.ttlSeconds > 0) {
      cache.set(key, { role, expiresAt: now() + deps.ttlSeconds * 1000 });
    }

    return role;
  };

  const invalidate: MembershipService["invalidate"] = ({
    userId,
    organizationId,
  }) => {
    cache.delete(cacheKey(userId, organizationId));
  };

  const setRole: MembershipService["setRole"] = async ({
    userId,
    organizationId,
    role,
    actorId,
  }) => {
    const previousRole = await getRole({ userId, organizationId });

    await update({ userId, organizationId, role });
    invalidate({ userId, organizationId });

    await deps.audit?.record({
      action: "member.role_changed",
      entityType: "member",
      entityId: userId,
      actorId,
      organizationId,
      changes: computeAuditDiff({ role: previousRole ?? null }, { role }),
      timestamp: new Date().toISOString(),
    });
  };

  const removeMembership: MembershipService["removeMembership"] = async ({
    userId,
    organizationId,
    actorId,
  }) => {
    const previousRole = await getRole({ userId, organizationId });

    await removeMember({ userId, organizationId, db: deps.db });
    invalidate({ userId, organizationId });

    await deps.audit?.record({
      action: "member.removed",
      entityType: "member",
      entityId: userId,
      actorId,
      organizationId,
      changes: computeAuditDiff({ role: previousRole ?? null }, { role: null }),
      timestamp: new Date().toISOString(),
    });
  };

  return { getRole, invalidate, setRole, removeMembership };
};
