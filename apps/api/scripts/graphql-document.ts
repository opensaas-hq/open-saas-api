import { join } from "node:path";
import { printSchema } from "graphql";
import { createGraphqlSchema } from "../src/graphql/schema";

/** Path of the committed SDL snapshot. */
export const schemaSnapshotPath = join(
  import.meta.dir,
  "..",
  "graphql.schema.graphql",
);

/**
 * Serialize the executable schema as SDL.
 *
 * The snapshot is printed from the same schema the endpoint serves, so it
 * cannot describe a shape the resolvers do not implement (§4.11).
 */
export const serializeSchema = (): string =>
  `${printSchema(createGraphqlSchema())}\n`;
