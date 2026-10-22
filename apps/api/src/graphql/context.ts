import type { Env, Logger } from "@opensaas/core";
import type { Context } from "hono";
import type { AppEnv, AppServices, SessionUser, TenantContext } from "../types";

/**
 * Per-request context of the GraphQL resolvers (§4.11).
 *
 * It is built from the Hono context after the tenant middleware ran, so the
 * session, the tenant and the services are the very same slots the REST
 * handlers read: the two surfaces share one authorization path.
 */
export type GraphqlContext = {
  /** Validated configuration (the GraphQL knobs live here). */
  env: Env;
  /** Logger of the request, for the unmapped errors. */
  logger: Logger;
  /** Application services: the only dependency of the resolvers. */
  services: AppServices;
  /** The authenticated user. */
  user: SessionUser;
  /** The organization, branch and role resolved from the session. */
  tenant: TenantContext;
};

/** Build the context of a GraphQL request from its Hono context. */
export const createGraphqlContext = (c: Context<AppEnv>): GraphqlContext => ({
  env: c.get("env"),
  logger: c.get("logger"),
  services: c.get("services"),
  user: c.get("user"),
  tenant: c.get("tenant"),
});
