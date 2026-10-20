import { getEnv } from "@opensaas/core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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
    // `statement_timeout` is a server connection parameter, not a pool option.
    connection: { statement_timeout: config.pool.statementTimeout },
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

/**
 * Lazily-initialized default handle, built from the validated environment via
 * `getEnv()`. Constructed on first use, not at import, so importing the package
 * never connects and never throws.
 */
export const getDb = (): Database => {
  if (!cachedDb) {
    const env = getEnv();
    cachedDb = createDb({
      databaseUrl: env.DATABASE_URL,
      pool: buildPoolConfig(env),
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

/**
 * Test seam: drop the memoized handle so the next {@link getDb} rebuilds from
 * the current environment. Production code never needs this.
 */
export const resetDb = (): void => {
  cachedDb = undefined;
};

/**
 * Run `callback` inside a single database transaction, rolling back on any
 * throw. Multi-statement repository flows must use this.
 */
export async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await getDb().transaction(callback);
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
