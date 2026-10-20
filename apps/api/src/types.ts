import type { Env } from "@opensaas/core";
import type { Database } from "@opensaas/database";

/** Tenant scope resolved from the session by the tenant middleware. */
export type TenantContext = {
  organizationId: string;
  branchId?: string;
};

/**
 * Hono context variables available to handlers. `env` and `db` are the DI
 * slots for the config/database factories (wired at boot in `index.ts`);
 * `user` / `session` / `tenant` are populated by the tenant middleware.
 */
export type AppVariables = {
  env: Env;
  db: Database;
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId?: string;
  };
  tenant: TenantContext;
};

export type AppEnv = {
  Variables: AppVariables;
};
