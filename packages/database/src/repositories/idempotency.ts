import { and, eq, lt } from "drizzle-orm";
import { type Database, type Transaction, getDb } from "../client";
import { idempotencyKeys } from "../schema";

/** The identity of an idempotency key: scope, endpoint and key. */
export type IdempotencyKeyRef = {
  /**
   * Logical owner of the key: the tenant (`organization:<id>`) or, for an
   * anonymous flow, a hash of the identity being created.
   */
  scope: string;
  /** The endpoint the key was used on, e.g. `POST /api/contacts`. */
  endpoint: string;
  /** The value of the `Idempotency-Key` header. */
  key: string;
};

/** A stored idempotency key. */
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

/** Options of {@link insertIdempotencyKey}. */
export type InsertIdempotencyKeyOptions = IdempotencyKeyRef & {
  /** Hash of the request payload the key was used with. */
  requestHash: string;
  /** Moment the entry expires; a later request with the same key runs again. */
  expiresAt: Date;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * Claim an idempotency key.
 *
 * The insert is the claim: it succeeds only for the first request that uses
 * the key, so two concurrent requests can never both run the operation. The
 * loser reads the stored entry and replays its response (§4.9).
 *
 * Returns `true` when the key was claimed by this call and `false` when it
 * already existed.
 */
export async function insertIdempotencyKey(
  options: InsertIdempotencyKeyOptions,
): Promise<boolean> {
  const executor = options.tx ?? options.db ?? getDb();

  const rows = await executor
    .insert(idempotencyKeys)
    .values({
      scope: options.scope,
      endpoint: options.endpoint,
      key: options.key,
      requestHash: options.requestHash,
      expiresAt: options.expiresAt,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  return rows.length > 0;
}

/** Options of {@link getIdempotencyKey}. */
export type GetIdempotencyKeyOptions = IdempotencyKeyRef & {
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * Read one stored idempotency key, or `undefined` when it does not exist.
 */
export async function getIdempotencyKey(
  options: GetIdempotencyKeyOptions,
): Promise<IdempotencyKey | undefined> {
  const executor = options.tx ?? options.db ?? getDb();

  const rows = await executor
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.scope, options.scope),
        eq(idempotencyKeys.endpoint, options.endpoint),
        eq(idempotencyKeys.key, options.key),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Options of {@link completeIdempotencyKey}. */
export type CompleteIdempotencyKeyOptions = IdempotencyKeyRef & {
  /** Status of the response that is stored for the replay. */
  responseStatus: number;
  /** Body of the response that is stored for the replay. */
  responseBody: unknown;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * Store the response of the request that claimed the key.
 *
 * A `null` status marks the entry as in flight: a concurrent replay waits for
 * the response instead of running the operation a second time (§4.9).
 */
export async function completeIdempotencyKey(
  options: CompleteIdempotencyKeyOptions,
): Promise<void> {
  const executor = options.tx ?? options.db ?? getDb();

  await executor
    .update(idempotencyKeys)
    .set({
      responseStatus: options.responseStatus,
      responseBody: options.responseBody as never,
    })
    .where(
      and(
        eq(idempotencyKeys.scope, options.scope),
        eq(idempotencyKeys.endpoint, options.endpoint),
        eq(idempotencyKeys.key, options.key),
      ),
    );
}

/** Options of {@link deleteIdempotencyKey}. */
export type DeleteIdempotencyKeyOptions = IdempotencyKeyRef & {
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * Release an idempotency key.
 *
 * It is called when the operation failed: a failed request must not lock the
 * key forever, the client has to be able to retry it.
 */
export async function deleteIdempotencyKey(
  options: DeleteIdempotencyKeyOptions,
): Promise<void> {
  const executor = options.tx ?? options.db ?? getDb();

  await executor
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.scope, options.scope),
        eq(idempotencyKeys.endpoint, options.endpoint),
        eq(idempotencyKeys.key, options.key),
      ),
    );
}

/** Options of {@link deleteExpiredIdempotencyKeys}. */
export type DeleteExpiredIdempotencyKeysOptions = {
  /** Moment the entries are considered expired. Defaults to now. */
  now?: Date;
  tx?: Transaction;
  /** Handle to run the query on. Defaults to the process-global proxy (TD-23). */
  db?: Database;
};

/**
 * Delete the entries whose TTL has passed.
 *
 * The table is a cache of recent responses, not a ledger: an expired key
 * simply stops being replayable, and the row is removed to keep the table
 * bounded.
 */
export async function deleteExpiredIdempotencyKeys(
  options: DeleteExpiredIdempotencyKeysOptions = {},
): Promise<number> {
  const executor = options.tx ?? options.db ?? getDb();

  const rows = await executor
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, options.now ?? new Date()))
    .returning({ key: idempotencyKeys.key });

  return rows.length;
}
