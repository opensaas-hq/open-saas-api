import {
  ServiceUnavailableError,
  TenantContextError,
  getEnv,
} from "@opensaas/core";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  CircuitBreaker,
  type Clock,
  type RandomFn,
  type Sleeper,
  isTransientDbError,
  realSleeper,
  withRetry,
} from "./client/resilience";
import * as schema from "./schema";

/** Pool and timeout settings for the underlying `postgres` client. */
export type DbPoolConfig = {
  /** Maximum number of connections held by the pool. */
  max: number;
  /** Seconds an idle connection is kept before being closed. */
  idleTimeout: number;
  /** Milliseconds after which a statement is cancelled by the server. */
  statementTimeout: number;
  /** Seconds to wait for the initial connection before failing. */
  connectTimeout: number;
};

/** Everything needed to build a database handle, without touching the env. */
export type DbConfig = {
  databaseUrl: string;
  pool: DbPoolConfig;
  /**
   * Postgres role the connection assumes at startup (`role` startup
   * parameter). The runtime connects as the dedicated `opensaas_app` role when
   * RLS is on, so the database itself refuses cross-tenant access (§2.5).
   */
  role?: string;
};

/**
 * Build a Drizzle database handle from explicit configuration. This is the only
 * place a connection is created: importing this module is side-effect-free and
 * never throws, so `@opensaas/database` is usable without a full environment.
 */
export const createDb = (config: DbConfig) => {
  const client = postgres(config.databaseUrl, {
    max: config.pool.max,
    idle_timeout: config.pool.idleTimeout,
    connect_timeout: config.pool.connectTimeout,
    // `statement_timeout` and `role` are server connection parameters, not pool
    // options. `role` switches the session to the RLS-bound app role.
    connection: {
      statement_timeout: config.pool.statementTimeout,
      ...(config.role ? { role: config.role } : {}),
    },
  });

  return drizzle(client, { schema });
};

/** A Drizzle database handle built by {@link createDb}. */
export type Database = ReturnType<typeof createDb>;

/** The transaction type yielded inside `db.transaction(...)` / `withTransaction`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let cachedDb: Database | undefined;

/**
 * Derive pool options from a validated environment. Kept pure so the mapping
 * from env to pool configuration is unit-testable without opening a connection.
 */
export const buildPoolConfig = (env: {
  DB_POOL_MAX: number;
  DB_IDLE_TIMEOUT_S: number;
  DB_STATEMENT_TIMEOUT_MS: number;
  DB_CONNECT_TIMEOUT_S: number;
}): DbPoolConfig => ({
  max: env.DB_POOL_MAX,
  idleTimeout: env.DB_IDLE_TIMEOUT_S,
  statementTimeout: env.DB_STATEMENT_TIMEOUT_MS,
  connectTimeout: env.DB_CONNECT_TIMEOUT_S,
});

/** Retry + circuit-breaker knobs derived from the validated environment. */
export type DbResilienceConfig = {
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  breaker: {
    enabled: boolean;
    failureThreshold: number;
    cooldownMs: number;
    probeTimeoutMs: number;
  };
};

/** Pure env → resilience mapping, so the knobs are testable in isolation. */
export const buildResilienceConfig = (env: {
  DB_RETRY_MAX_ATTEMPTS: number;
  DB_RETRY_BASE_DELAY_MS: number;
  DB_RETRY_MAX_DELAY_MS: number;
  DB_BREAKER_ENABLED: boolean;
  DB_BREAKER_FAILURE_THRESHOLD: number;
  DB_BREAKER_COOLDOWN_MS: number;
  DB_BREAKER_PROBE_TIMEOUT_MS: number;
}): DbResilienceConfig => ({
  retry: {
    maxAttempts: env.DB_RETRY_MAX_ATTEMPTS,
    baseDelayMs: env.DB_RETRY_BASE_DELAY_MS,
    maxDelayMs: env.DB_RETRY_MAX_DELAY_MS,
  },
  breaker: {
    enabled: env.DB_BREAKER_ENABLED,
    failureThreshold: env.DB_BREAKER_FAILURE_THRESHOLD,
    cooldownMs: env.DB_BREAKER_COOLDOWN_MS,
    probeTimeoutMs: env.DB_BREAKER_PROBE_TIMEOUT_MS,
  },
});

/**
 * The dedicated RLS-bound runtime role the client assumes when RLS is on.
 */
export const RLS_APP_ROLE = "opensaas_app";

/**
 * Lazily-initialized default handle, built from the validated environment via
 * `getEnv()`. Constructed on first use, not at import, so importing the package
 * never connects and never throws.
 *
 * When `RLS_ENABLED` is on, the connection assumes `opensaas_app` at startup so
 * row-level security applies to every query (§2.5).
 */
export const getDb = (): Database => {
  if (!cachedDb) {
    const env = getEnv();
    cachedDb = createDb({
      databaseUrl: env.DATABASE_URL,
      pool: buildPoolConfig(env),
      role: env.RLS_ENABLED ? RLS_APP_ROLE : undefined,
    });
  }
  return cachedDb;
};

/**
 * Proxy that forwards every property access to {@link getDb}. Repositories use
 * `db` exactly as before, but the connection is only opened on first property
 * access.
 */
export const db: Database = new Proxy({} as Database, {
  get: (_target, property) => Reflect.get(getDb(), property),
});

let breaker: CircuitBreaker | undefined;

/** Lazily-built process-wide circuit breaker for the default handle. */
export const getBreaker = (): CircuitBreaker => {
  if (!breaker) {
    const env = getEnv();
    const config = buildResilienceConfig(env);
    breaker = new CircuitBreaker({
      failureThreshold: config.breaker.failureThreshold,
      cooldownMs: config.breaker.cooldownMs,
      probeTimeoutMs: config.breaker.probeTimeoutMs,
    });
  }
  return breaker;
};

/** Test seam: drop the memoized breaker so the next call rebuilds it. */
export const resetBreaker = (): void => {
  breaker = undefined;
};

/** Injectable dependencies for the resilient executor, for tests. */
export type ResilientDeps = {
  sleeper?: Sleeper;
  random?: RandomFn;
  clock?: Clock;
  breaker?: CircuitBreaker;
};

/**
 * Run an idempotent database operation through the retry policy and the
 * circuit breaker. Transient errors are retried with jittered backoff; while
 * the breaker is open the call fails fast with a 503 `ServiceUnavailableError`.
 *
 * Writes that are not idempotent must pass an explicit `idempotencyKey` so a
 * retry cannot duplicate them.
 */
export const executeResilient = async <T>(
  operation: () => Promise<T>,
  options: { idempotencyKey?: string; idempotent?: boolean },
  deps: ResilientDeps = {},
): Promise<T> => {
  const env = getEnv();
  const config = buildResilienceConfig(env);
  const activeBreaker = deps.breaker ?? getBreaker();

  const run = () =>
    withRetry(operation, {
      maxAttempts: config.retry.maxAttempts,
      baseDelayMs: config.retry.baseDelayMs,
      maxDelayMs: config.retry.maxDelayMs,
      isRetryable: isTransientDbError,
      idempotent: options.idempotent,
      idempotencyKey: options.idempotencyKey,
      sleeper: deps.sleeper,
      random: deps.random,
    });

  if (!config.breaker.enabled) {
    return await run();
  }

  return await activeBreaker.execute(run);
};

/**
 * Wait for the database to accept a connection, retrying transient failures
 * with jittered backoff. Call once at boot so startup fails with a typed error
 * instead of a raw driver message.
 */
export const waitForDatabase = async (
  deps: ResilientDeps & { probe?: () => Promise<unknown> } = {},
): Promise<void> => {
  const env = getEnv();
  const config = buildResilienceConfig(env);
  const probe = deps.probe ?? (() => getDb().$client`SELECT 1`);

  try {
    await withRetry(() => probe(), {
      maxAttempts: config.retry.maxAttempts,
      baseDelayMs: config.retry.baseDelayMs,
      maxDelayMs: config.retry.maxDelayMs,
      isRetryable: isTransientDbError,
      idempotent: true,
      sleeper: deps.sleeper ?? realSleeper,
      random: deps.random,
    });
  } catch (error) {
    throw new ServiceUnavailableError("Database is unreachable after retries", {
      reason: "startup_connect_failed",
      cause: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Test seam: drop the memoized handle so the next {@link getDb} rebuilds from
 * the current environment. Production code never needs this.
 */
export const resetDb = (): void => {
  cachedDb = undefined;
};

/**
 * Run `callback` inside a single database transaction, rolling back on any
 * throw. No tenant context is set — use this only for flows that are not
 * tenant-scoped (migrations, health probes, framework tables).
 *
 * `db` overrides the process-global handle, so an injected handle reaches the
 * data layer instead of the module proxy (TD-23).
 */
export async function withRawTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
  db?: Database,
): Promise<T> {
  return await (db ?? getDb()).transaction(callback);
}

/** Options for {@link withTransaction}: the tenant scopes the transaction. */
export type TenantTransactionOptions<T> = {
  /** The tenant every statement in the transaction is scoped to. */
  organizationId: string;
  /** The work to perform inside the tenant-scoped transaction. */
  callback: (tx: Transaction) => Promise<T>;
  /**
   * Handle to run the transaction on. Defaults to the process-global proxy;
   * an injected handle keeps the transaction on the caller's connection (TD-23).
   */
  db?: Database;
};

/**
 * Reject a missing tenant before any query runs. A tenant-scoped operation
 * without an organization is a programming error: it must fail loudly, never
 * fall back to an unscoped (permissive) path.
 */
const requireOrganizationId = (organizationId: string | undefined): string => {
  if (!organizationId || organizationId.trim() === "") {
    throw new TenantContextError(
      "A tenant-scoped operation requires a non-empty organizationId",
      { field: "organizationId" },
    );
  }
  return organizationId;
};

/**
 * Set the transaction-local tenant GUC (`app.current_org`) read by the
 * row-level-security policies (§2.5.1). `set_config(..., true)` is local to the
 * transaction, so the value never leaks onto the pooled connection.
 *
 * When `RLS_ENABLED` is off, RLS is not enforced and the GUC is unnecessary;
 * skipping it keeps the flag-off behavior identical to pre-RLS (no extra
 * round-trip, no behavioral regression — §2.5.4 AC4).
 */
const setTenantGuc = async (
  tx: Transaction,
  organizationId: string,
): Promise<void> => {
  if (!getEnv().RLS_ENABLED) return;
  await tx.execute(
    sql`SELECT set_config('app.current_org', ${organizationId}, true)`,
  );
};

/**
 * Run `callback` inside a single database transaction scoped to one tenant:
 * the first statement sets the `app.current_org` GUC so the RLS policies see
 * the caller's tenant, then the callback runs. Rolls back on any throw.
 *
 * A missing `organizationId` throws {@link TenantContextError} before any SQL.
 */
export async function withTransaction<T>(
  options: TenantTransactionOptions<T>,
): Promise<T> {
  const organizationId = requireOrganizationId(options.organizationId);
  return await (options.db ?? getDb()).transaction(async (tx) => {
    await setTenantGuc(tx, organizationId);
    return await options.callback(tx);
  });
}

/** Options for {@link runInTenantContext}. */
export type TenantContextOptions<T> = {
  /** The tenant the operation is scoped to. */
  organizationId: string;
  /** The work to run inside the tenant-scoped transaction. */
  run: (tx: Transaction) => Promise<T>;
  /**
   * An existing transaction to reuse. When provided, the caller already set the
   * GUC (e.g. via {@link withTransaction}) and no new transaction is opened.
   */
  tx?: Transaction;
  /**
   * Handle to run the operation on. Defaults to the process-global proxy; an
   * injected handle keeps the query on the caller's connection (TD-23).
   */
  db?: Database;
};

/**
 * Execute a single tenant-scoped operation with the tenant GUC set. Single
 * reads and writes funnel through this so **every** repository call path
 * carries the GUC, not only multi-statement flows. When `tx` is supplied the
 * operation joins the caller's transaction instead of opening a new one.
 *
 * A missing `organizationId` throws {@link TenantContextError} before any SQL.
 */
export async function runInTenantContext<T>(
  options: TenantContextOptions<T>,
): Promise<T> {
  const organizationId = requireOrganizationId(options.organizationId);
  if (options.tx) {
    return await options.run(options.tx);
  }
  return await (options.db ?? getDb()).transaction(async (tx) => {
    await setTenantGuc(tx, organizationId);
    return await options.run(tx);
  });
}

/**
 * Close the pool and release every connection, for graceful shutdown. Resolves
 * once no handles remain; safe to call when no connection was ever opened.
 */
export async function close(): Promise<void> {
  if (!cachedDb) return;
  await cachedDb.$client.end();
  cachedDb = undefined;
}
