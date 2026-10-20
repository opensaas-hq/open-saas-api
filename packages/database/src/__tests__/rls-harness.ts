import postgres from "postgres";
import { APP_ROLE } from "./rls-support";

/**
 * A raw `postgres` client bound to the application role, used by the RLS proof
 * suite (§2.5.3). A connection string is required so the client can authenticate
 * as the owner and then `SET ROLE` to `opensaas_app` (the app role has no
 * password of its own in the local/CI setup).
 */
export type AppRoleClient = {
  /** Run `fn` with the role switched to the application role. */
  asAppRole: <T>(fn: (sql: postgres.Sql) => Promise<T>) => Promise<T>;
  /** Run `fn` with the tenant GUC set for one organization (single query). */
  asTenant: <T>(
    organizationId: string,
    fn: (sql: postgres.Sql) => Promise<T>,
  ) => Promise<T>;
  /** Run `fn` with no tenant GUC — deny-by-default probe. */
  raw: <T>(fn: (sql: postgres.Sql) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
};

/**
 * Build a client that authenticates with `databaseUrl` and switches to the
 * application role for every operation, so RLS is enforced on the queries.
 *
 * Each call opens a connection, sets the role/GUC, runs, and releases it —
 * mirroring how the runtime wraps a tenant operation in its own transaction.
 */
export const createAppRoleClient = (databaseUrl: string): AppRoleClient => {
  const pool = postgres(databaseUrl, { max: 1 });

  const asAppRole = async <T>(
    fn: (sql: postgres.Sql) => Promise<T>,
  ): Promise<T> => {
    return (await pool.begin(async (tx) => {
      await tx.unsafe(`SET ROLE ${APP_ROLE}`);
      return await fn(tx as unknown as postgres.Sql);
    })) as T;
  };

  return {
    asAppRole,
    asTenant: (organizationId, fn) =>
      asAppRole(async (tx) => {
        await tx`SELECT set_config('app.current_org', ${organizationId}, true)`;
        return await fn(tx);
      }),
    raw: (fn) => asAppRole(fn),
    end: () => pool.end(),
  };
};
