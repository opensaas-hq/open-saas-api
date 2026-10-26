import { and, eq, isNull, or, sql } from "drizzle-orm";
import { type Transaction, db } from "../client";
import { registrationCode } from "../schema";

/** Options for {@link createRegistrationCode}. */
export type CreateRegistrationCodeOptions = {
  code: string;
  maxUses?: number;
  expiresAt?: Date;
  tx?: Transaction;
};

/**
 * Create an invite code. Defaults to a single-use, non-expiring code.
 * `registration_code` is project-owned and not tenant-scoped.
 */
export async function createRegistrationCode(
  options: CreateRegistrationCodeOptions,
) {
  const executor = options.tx ?? db;

  const [row] = await executor
    .insert(registrationCode)
    .values({
      code: options.code,
      maxUses: options.maxUses ?? 1,
      expiresAt: options.expiresAt ?? null,
    })
    .returning();

  return row;
}

/** Options for {@link consumeRegistrationCode}. */
export type ConsumeRegistrationCodeOptions = {
  code: string;
  userId?: string;
  /**
   * An existing transaction to join. Registration (§3.2) consumes the code in
   * the same transaction as the user/organization creation, so validation and
   * consumption are atomic with the flow.
   */
  tx?: Transaction;
};

/** Result of {@link consumeRegistrationCode}. */
export type ConsumeRegistrationCodeResult =
  | { consumed: true }
  | { consumed: false; reason: "not_found" | "not_pending" | "expired" };

/**
 * Atomically validate and consume a single use of an invite code.
 *
 * The row is locked with `SELECT ... FOR UPDATE` so two concurrent
 * registrations cannot both pass validation for the last remaining use — the
 * second waits, re-reads the incremented `use_count`, and is rejected. When the
 * code reaches `max_uses` its status flips to `consumed`.
 *
 * Returns a discriminated result instead of throwing so the caller (the
 * `invite_code` strategy) owns the user-facing error (§3.2).
 */
export async function consumeRegistrationCode(
  options: ConsumeRegistrationCodeOptions,
): Promise<ConsumeRegistrationCodeResult> {
  const run = async (tx: Transaction) => {
    const [row] = await tx
      .select()
      .from(registrationCode)
      .where(eq(registrationCode.code, options.code))
      .for("update")
      .limit(1);

    if (!row) {
      return { consumed: false, reason: "not_found" } as const;
    }

    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return { consumed: false, reason: "expired" } as const;
    }

    if (row.status !== "pending" || row.useCount >= row.maxUses) {
      return { consumed: false, reason: "not_pending" } as const;
    }

    const nextUseCount = row.useCount + 1;
    const exhausted = nextUseCount >= row.maxUses;

    await tx
      .update(registrationCode)
      .set({
        useCount: nextUseCount,
        status: exhausted ? "consumed" : "pending",
        consumedAt: exhausted ? new Date() : row.consumedAt,
        consumedByUserId: exhausted
          ? (options.userId ?? null)
          : row.consumedByUserId,
      })
      .where(eq(registrationCode.id, row.id));

    return { consumed: true } as const;
  };

  if (options.tx) {
    return await run(options.tx);
  }
  return await db.transaction(run);
}

/** Options for {@link getRegistrationCode}. */
export type GetRegistrationCodeOptions = {
  code: string;
  tx?: Transaction;
};

/** Fetch a registration code by value, or `undefined` when none exists. */
export async function getRegistrationCode(options: GetRegistrationCodeOptions) {
  const executor = options.tx ?? db;

  const [row] = await executor
    .select()
    .from(registrationCode)
    .where(eq(registrationCode.code, options.code))
    .limit(1);

  return row;
}

/** Count still-consumable codes, for tests and admin reporting. */
export async function countPendingRegistrationCodes(tx?: Transaction) {
  const executor = tx ?? db;

  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(registrationCode)
    .where(
      and(
        eq(registrationCode.status, "pending"),
        or(
          isNull(registrationCode.expiresAt),
          sql`${registrationCode.expiresAt} > now()`,
        ),
      ),
    );

  return row?.count ?? 0;
}
