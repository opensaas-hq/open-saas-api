import type { Env } from "@opensaas/core";
import type { Database } from "@opensaas/database";

export type TenantContext = {
  organizationId: string;
  branchId?: string;
};

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
