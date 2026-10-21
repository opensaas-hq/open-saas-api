import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { member } from "../schema";

/** A membership row as stored in the `member` table. */
export type MemberRecord = typeof member.$inferSelect;

/** Options for the membership lookups: the tenant is required. */
export type MemberLookupOptions = {
  /** The organization the membership must belong to. */
  organizationId: string;
  /** The user the membership must belong to. */
  userId: string;
};

/** Options for {@link listMembers}. */
export type ListMembersOptions = {
  /** The organization whose memberships are listed. */
  organizationId: string;
};

/** Options for {@link updateMemberRole}. */
export type UpdateMemberRoleOptions = MemberLookupOptions & {
  /** The new role to store. */
  role: string;
};

/**
 * Read the membership row of one user in one organization.
 *
 * The `member` table belongs to the Better Auth organization plugin, so it is
 * outside the RLS scope (§2.5) and is queried with the default handle. The
 * organization is always part of the `WHERE`, so a lookup can never cross the
 * tenant boundary.
 */
export async function getMember(
  options: MemberLookupOptions,
): Promise<MemberRecord | undefined> {
  const [row] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, options.organizationId),
        eq(member.userId, options.userId),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Read the role of one user in one organization, or `undefined` when the user
 * is not a member. This is the query behind the membership check of the tenant
 * middleware (§4.3).
 */
export async function getMemberRole(
  options: MemberLookupOptions,
): Promise<string | undefined> {
  const row = await getMember(options);
  return row?.role;
}

/** List every membership of one organization, oldest first. */
export async function listMembers(
  options: ListMembersOptions,
): Promise<MemberRecord[]> {
  return await db
    .select()
    .from(member)
    .where(eq(member.organizationId, options.organizationId));
}

/**
 * Change the role of a member. The organization is part of the `WHERE`, so the
 * update can only ever touch a membership of that organization. Returns the
 * updated row, or `undefined` when the user was not a member.
 */
export async function updateMemberRole(
  options: UpdateMemberRoleOptions,
): Promise<MemberRecord | undefined> {
  const [row] = await db
    .update(member)
    .set({ role: options.role })
    .where(
      and(
        eq(member.organizationId, options.organizationId),
        eq(member.userId, options.userId),
      ),
    )
    .returning();

  return row;
}

/**
 * Remove a membership. Returns `true` when a row was deleted, `false` when the
 * user was not a member of the organization.
 */
export async function removeMember(
  options: MemberLookupOptions,
): Promise<boolean> {
  const rows = await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, options.organizationId),
        eq(member.userId, options.userId),
      ),
    )
    .returning({ id: member.id });

  return rows.length > 0;
}
