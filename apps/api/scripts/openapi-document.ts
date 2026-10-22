import type { AuthInstance } from "@opensaas/auth";
import { createEnv, createLogger } from "@opensaas/core";
import type { Database } from "@opensaas/database";
import { createApp } from "../src/app";
import { buildOpenApiDocument } from "../src/openapi/document";

/**
 * Build the OpenAPI document of the application.
 *
 * The document is produced by the very same application the server runs, so
 * the committed snapshot cannot describe another API than the deployed one.
 * The script only replaces the dependencies that would open a connection — the
 * database handle and the auth instance — because the contract does not depend
 * on them: no route is executed to generate it.
 */
export const buildDocument = (): Record<string, unknown> => {
  const env = createEnv({
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://localhost:5432/opensaas",
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ??
      "openapi-snapshot-secret-at-least-32-characters",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  });

  const app = createApp({
    env,
    // The contract never touches the database: the routes are only mounted.
    db: {} as Database,
    // Same for the auth instance: the Better Auth surface is not part of the
    // product contract (§4.1).
    auth: {
      handler: async () => new Response(null, { status: 404 }),
    } as unknown as AuthInstance,
    logger: createLogger(env),
    // The breaker of the database client is a runtime concern: the contract
    // does not depend on its state.
    breaker: { getState: () => "closed" },
  });

  return buildOpenApiDocument(app);
};

/** The snapshot of the contract, as it is written to disk. */
export const serializeDocument = (): string =>
  `${JSON.stringify(buildDocument(), null, 2)}\n`;

/** The path of the committed snapshot, relative to the API package. */
export const snapshotPath = new URL("../openapi.json", import.meta.url);
