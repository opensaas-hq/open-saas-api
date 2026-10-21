import type { AuthInstance } from "@opensaas/auth";
import type { Env, Logger } from "@opensaas/core";
import type { Database } from "@opensaas/database";

/**
 * Session payload inferred from the Better Auth instance (§4.7).
 *
 * The types come from the auth configuration itself, so a new session field
 * (or a plugin-provided one, such as the organization plugin's
 * `activeOrganizationId`) is visible at the usage site instead of silently
 * drifting from a hand-written copy.
 */
type AuthSession = AuthInstance["$Infer"]["Session"];

/** The authenticated user attached to the request context. */
export type SessionUser = AuthSession["user"];

/** The authenticated session attached to the request context. */
export type SessionRecord = AuthSession["session"];

/** Tenant scope resolved from the session by the tenant middleware. */
export type TenantContext = {
  organizationId: string;
  branchId?: string;
};

/**
 * Hono context variables available to handlers.
 *
 * `env`, `db`, `auth` and `logger` are the dependency-injection slots, assigned
 * at boot by the factory in `app.ts`; `user`, `session` and `tenant` are
 * populated by the tenant middleware. Every slot is declared here, so a
 * `c.set(...)` without a matching type is a compile error (§4.7).
 */
export type AppVariables = {
  env: Env;
  db: Database;
  auth: AuthInstance;
  logger: Logger;
  user: SessionUser;
  session: SessionRecord;
  tenant: TenantContext;
};

export type AppEnv = {
  Variables: AppVariables;
};
