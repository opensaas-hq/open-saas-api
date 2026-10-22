import { writeFile } from "node:fs/promises";
import { schemaSnapshotPath, serializeSchema } from "./graphql-document";

/**
 * Write the SDL snapshot of the GraphQL schema.
 *
 * The snapshot is committed so a reviewer sees the schema change in the diff,
 * and so CI can detect a drift between the executable schema and the
 * published contract (§4.11).
 */
const sdl = serializeSchema();
await writeFile(schemaSnapshotPath, sdl);

console.log(
  `✅ GraphQL SDL snapshot written: apps/api/graphql.schema.graphql (${sdl.length} bytes)`,
);
