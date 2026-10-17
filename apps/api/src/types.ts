import type { Env } from "@opensaas/core";
import type { Database } from "@opensaas/database";

export type AppVariables = {
  env: Env;
  db: Database;
};

export type AppEnv = {
  Variables: AppVariables;
};
