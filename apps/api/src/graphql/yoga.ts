import type { Env } from "@opensaas/core";
import { createYoga } from "graphql-yoga";
import type { GraphqlContext } from "./context";
import { createQuerySafetyPlugin } from "./safety";
import { createGraphqlSchema } from "./schema";

/** Options of {@link createGraphqlEndpoint}. */
export type GraphqlEndpointOptions = {
  /** Validated configuration: the safety limits and the introspection flag. */
  env: Env;
};

/**
 * Build the GraphQL endpoint (§4.11).
 *
 * The endpoint is API-only: the interactive playground is disabled, so the
 * strict security headers of the pipeline apply unchanged (a browser UI would
 * need a CSP exception for its CDN assets). Introspection is on outside
 * production by default and can be forced either way with
 * `GRAPHQL_INTROSPECTION_ENABLED`.
 */
export const createGraphqlEndpoint = ({ env }: GraphqlEndpointOptions) =>
  createYoga<GraphqlContext>({
    schema: createGraphqlSchema(),
    graphqlEndpoint: "/graphql",
    graphiql: false,
    // The access log of the pipeline already records every request (§4.5).
    logging: false,
    plugins: [
      createQuerySafetyPlugin({
        maxDepth: env.GRAPHQL_MAX_DEPTH,
        maxCost: env.GRAPHQL_MAX_COMPLEXITY,
        introspection:
          env.GRAPHQL_INTROSPECTION_ENABLED ?? env.NODE_ENV !== "production",
      }),
    ],
  });
