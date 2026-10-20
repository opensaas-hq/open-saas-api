import { ServiceUnavailableError } from "@opensaas/core";

/** Sleep for `ms`; injectable so tests never wait on real time. */
export type Sleeper = (ms: number) => Promise<void>;

/** Returns a float in [0, 1); injectable for deterministic jitter in tests. */
export type RandomFn = () => number;

/** Returns the current time in milliseconds; injectable clock for tests. */
export type Clock = () => number;

/** Default sleeper backed by `setTimeout`. */
export const realSleeper: Sleeper = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Options for {@link withRetry}. */
export type RetryOptions = {
  /** Maximum attempts, including the first. Must be >= 1. */
  maxAttempts: number;
  /** Base delay in milliseconds for the exponential backoff. */
  baseDelayMs: number;
  /** Upper bound for any single delay. */
  maxDelayMs: number;
  /** Classifies an error: return `true` to retry, `false` to rethrow at once. */
  isRetryable: (error: unknown) => boolean;
  /**
   * Whether the operation is safe to repeat. Non-idempotent operations are
   * never retried unless an idempotency key was supplied.
   */
  idempotent?: boolean;
  /** When present, makes a non-idempotent operation retryable. */
  idempotencyKey?: string;
  /** Injected for tests. */
  sleeper?: Sleeper;
  /** Injected for tests. */
  random?: RandomFn;
};

/**
 * Run `operation`, retrying only when it is safe and worthwhile. Backoff is
 * exponential with full jitter: `delay = random() * min(maxDelay, base * 2^n)`.
 *
 * A non-idempotent operation is retried **only** when an `idempotencyKey` is
 * supplied — repeating a write without one risks duplicating it.
 */
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const sleeper = options.sleeper ?? realSleeper;
  const random = options.random ?? Math.random;
  const allowedToRetry =
    options.idempotent === true || options.idempotencyKey !== undefined;

  let lastError: unknown;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === options.maxAttempts - 1;
      if (isLastAttempt || !options.isRetryable(error) || !allowedToRetry) {
        throw error;
      }

      const ceiling = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** attempt,
      );
      await sleeper(random() * ceiling);
    }
  }

  // Unreachable: the loop returns or throws, but keeps the type checker happy.
  throw lastError;
};

/** Circuit breaker states. */
export type BreakerState = "closed" | "open" | "halfOpen";

/** Options for {@link CircuitBreaker}. */
export type CircuitBreakerOptions = {
  /** Consecutive failures that trip the breaker from `closed` to `open`. */
  failureThreshold: number;
  /** Milliseconds the breaker stays `open` before allowing a probe. */
  cooldownMs: number;
  /** Called whenever the state changes (e.g. to publish metrics, §5.6). */
  onStateChange?: (state: BreakerState, previous: BreakerState) => void;
  /** Injected clock for tests. */
  now?: Clock;
};

/**
 * Counts consecutive failures and fails fast while open. After `cooldownMs` it
 * moves to `halfOpen` and lets a single probe through: success closes it,
 * failure reopens it. Deliberately clock-injected so tests are deterministic.
 */
export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private readonly now: Clock;

  /** Total calls rejected while open (for metrics). */
  public rejected = 0;
  /** Total times the breaker tripped to `open`. */
  public trips = 0;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Current state, advancing `open` → `halfOpen` once the cooldown elapsed. */
  getState(): BreakerState {
    if (
      this.state === "open" &&
      this.now() - this.openedAt >= this.options.cooldownMs
    ) {
      this.transition("halfOpen");
    }
    return this.state;
  }

  /** Run `operation` through the breaker, updating its state from the result. */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === "open") {
      this.rejected++;
      throw new ServiceUnavailableError("Database circuit breaker is open", {
        reason: "circuit_open",
      });
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state !== "closed") {
      this.transition("closed");
    }
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === "halfOpen") {
      this.trip();
      return;
    }
    if (this.failures >= this.options.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.openedAt = this.now();
    this.trips++;
    this.transition("open");
  }

  private transition(next: BreakerState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.options.onStateChange?.(next, previous);
  }
}

/**
 * PostgreSQL SQLSTATE codes that represent transient conditions worth retrying:
 * dropped/refused connections, server shutdown, serialization failures and
 * deadlocks, and "too many connections". Everything else (constraint
 * violations, syntax errors, ...) is permanent and must not be retried.
 */
const TRANSIENT_SQLSTATES = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "55P03", // lock_not_available
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** True when an error carries the given PostgreSQL SQLSTATE code. */
const hasSqlState = (error: unknown, codes: Set<string>): boolean => {
  const code = isRecord(error) ? error.code : undefined;
  return typeof code === "string" && codes.has(code);
};

/**
 * Classify a database error as transient (retryable) or permanent. Connection
 * errors raised by the `postgres` driver surface as `Error` with a `code`
 * property; other errors are treated as permanent so retries never mask bugs.
 */
export const isTransientDbError = (error: unknown): boolean =>
  hasSqlState(error, TRANSIENT_SQLSTATES);
