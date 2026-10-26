import { createHash } from "node:crypto";
import { ConflictError } from "@opensaas/core";
import {
  type Database,
  completeIdempotencyKey,
  deleteExpiredIdempotencyKeys,
  deleteIdempotencyKey,
  getIdempotencyKey,
  insertIdempotencyKey,
} from "@opensaas/database";

/** How often a concurrent replay checks whether the first request finished. */
const POLL_INTERVAL_MS = 25;

/** The default time a concurrent replay waits for the first request. */
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

/** How often the expired entries are removed. */
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Serialize a payload into a canonical string.
 *
 * The keys are sorted and the undefined values are dropped, so two payloads
 * that only differ in the order of their keys hash the same: a client that
 * retries with the same body in a different order is a replay, not a
 * conflict.
 */
const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
};

/**
 * Hash a request payload.
 *
 * The hash detects a key that is reused with a different body: the second
 * request is a conflict, not a replay (§4.9).
 */
export const hashPayload = (payload: unknown): string =>
  createHash("sha256").update(canonicalize(payload)).digest("hex");

/** The result of an operation protected by an idempotency key. */
export type IdempotencyResult<T> = {
  /** The status the response is answered with. */
  status: number;
  /** The body of the response. */
  body: T;
  /** True when the response was replayed instead of produced again. */
  replayed: boolean;
};

/** The input of {@link IdempotencyService.execute}. */
export type IdempotencyInput<T> = {
  /**
   * Logical owner of the key: the tenant (`organization:<id>`) or, for an
   * anonymous flow, a hash of the identity being created. Two tenants never
   * share a key space.
   */
  scope: string;
  /** The endpoint the key is used on, e.g. `POST /api/contacts`. */
  endpoint: string;
  /** The value of the `Idempotency-Key` header; absent means no protection. */
  key?: string | undefined;
  /** The request payload, hashed to detect a different body. */
  payload: unknown;
  /** The operation to run when the key is claimed. */
  operation: () => Promise<{ status: number; body: T }>;
};

/**
 * The idempotency service: the owner of the replay rules of the write
 * endpoints (§4.9).
 */
export type IdempotencyService = {
  /**
   * Run an operation under an idempotency key.
   *
   * Without a key the operation runs once and its response is returned. With
   * a key the first request claims it and stores its response; a later
   * request with the same key and the same payload replays that response
   * instead of running the operation again.
   */
  execute: <T>(input: IdempotencyInput<T>) => Promise<IdempotencyResult<T>>;
};

/** Dependencies of {@link createIdempotencyService}. */
export type IdempotencyServiceDeps = {
  /**
   * How long a stored response stays replayable, in seconds (§4.9). It is a
   * deployment knob, so the expiry is not hard-coded.
   */
  ttlSeconds: number;
  /**
   * Handle the entries are stored on. Defaults to the process-global proxy;
   * the app factory injects its own handle (TD-35).
   */
  db?: Database;
  /**
   * How long a concurrent replay waits for the first request to finish.
   * Defaults to five seconds.
   */
  waitTimeoutMs?: number;
};

/** Wait for a given number of milliseconds. */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Build the idempotency service.
 *
 * The claim is an insert, not a check-then-act: the database decides which
 * request owns the key, so two concurrent requests can never run the same
 * operation twice. The loser reads the stored entry and waits for the
 * response, which is the only way a retry after a timeout is safe.
 */
export const createIdempotencyService = (
  deps: IdempotencyServiceDeps,
): IdempotencyService => {
  const waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

  /** Moment of the last cleanup, so it runs at most once per interval. */
  let lastCleanupAt = 0;

  /**
   * Remove the entries whose TTL has passed.
   *
   * The cleanup is opportunistic: it runs before a claim, at most once a
   * minute, so the table stays bounded without a background job.
   */
  const cleanup = async (): Promise<number> => {
    const now = Date.now();

    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return 0;
    }

    lastCleanupAt = now;

    return await deleteExpiredIdempotencyKeys({ db: deps.db });
  };

  const execute = async <T>(
    input: IdempotencyInput<T>,
  ): Promise<IdempotencyResult<T>> => {
    const key = input.key?.trim();

    // Without a key there is nothing to replay: the operation runs once.
    if (!key) {
      const result = await input.operation();
      return { status: result.status, body: result.body, replayed: false };
    }

    await cleanup();

    const requestHash = hashPayload(input.payload);
    const scope = input.scope;
    const endpoint = input.endpoint;
    const deadline = Date.now() + waitTimeoutMs;

    for (;;) {
      const expiresAt = new Date(Date.now() + deps.ttlSeconds * 1000);

      const claimed = await insertIdempotencyKey({
        scope,
        endpoint,
        key,
        requestHash,
        expiresAt,
        db: deps.db,
      });

      if (claimed) {
        try {
          const result = await input.operation();

          await completeIdempotencyKey({
            scope,
            endpoint,
            key,
            responseStatus: result.status,
            responseBody: result.body,
            db: deps.db,
          });

          return { status: result.status, body: result.body, replayed: false };
        } catch (error) {
          // A failed operation releases the key: the client has to be able to
          // retry it instead of being stuck with a failed entry.
          await deleteIdempotencyKey({ scope, endpoint, key, db: deps.db });
          throw error;
        }
      }

      const existing = await getIdempotencyKey({
        scope,
        endpoint,
        key,
        db: deps.db,
      });

      // The owner released the key between the insert and the read: the entry
      // is gone, so the claim can be retried.
      if (!existing) {
        if (Date.now() >= deadline) {
          throw new ConflictError(
            "The idempotency key could not be claimed in time",
            { scope, endpoint },
          );
        }

        continue;
      }

      // An expired entry is not replayable anymore: the TTL has passed, so
      // the operation may run again.
      if (existing.expiresAt.getTime() <= Date.now()) {
        await deleteIdempotencyKey({ scope, endpoint, key, db: deps.db });
        continue;
      }

      if (existing.requestHash !== requestHash) {
        throw new ConflictError(
          "The idempotency key was already used with a different payload",
          { scope, endpoint },
        );
      }

      // The response is stored: this is a replay.
      if (existing.responseStatus !== null) {
        return {
          status: existing.responseStatus,
          body: existing.responseBody as T,
          replayed: true,
        };
      }

      // The key is claimed but the operation is still running: wait for it
      // instead of running a second operation.
      if (Date.now() >= deadline) {
        throw new ConflictError(
          "A request with the same idempotency key is still in progress",
          { scope, endpoint },
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  };

  return {
    execute,
  };
};
