import { eq } from "drizzle-orm";
import { type Transaction, db } from "../client";
import { waitlistEntry } from "../schema";

/** Options for {@link createWaitlistEntry}. */
export type CreateWaitlistEntryOptions = {
  email: string;
  userId?: string;
  /**
   * An existing transaction to join. Registration (§3.1) persists the waitlist
   * row in the same transaction as the user/organization, so a mid-flow failure
   * leaves no partial rows. `waitlist_entry` is project-owned and not
   * tenant-scoped, so no tenant GUC is set here.
   */
  tx?: Transaction;
};

/**
 * Record a waitlisted registration. Keyed by email so the row exists even when
 * no `user` has been created yet.
 */
export async function createWaitlistEntry(options: CreateWaitlistEntryOptions) {
  const executor = options.tx ?? db;

  const [entry] = await executor
    .insert(waitlistEntry)
    .values({
      email: options.email,
      userId: options.userId ?? null,
    })
    .returning();

  return entry;
}

/** Options for {@link getWaitlistEntryByEmail}. */
export type GetWaitlistEntryOptions = {
  email: string;
  tx?: Transaction;
};

/** Fetch the waitlist row for an email, or `undefined` when none exists. */
export async function getWaitlistEntryByEmail(
  options: GetWaitlistEntryOptions,
) {
  const executor = options.tx ?? db;

  const [entry] = await executor
    .select()
    .from(waitlistEntry)
    .where(eq(waitlistEntry.email, options.email))
    .limit(1);

  return entry;
}
