import { readFile } from "node:fs/promises";
import { schemaSnapshotPath, serializeSchema } from "./graphql-document";

/**
 * Check that the committed SDL snapshot matches the executable schema.
 *
 * This is the drift check of CI (§4.11): when a type, a field or a resolver
 * changes without the snapshot being regenerated, the check fails and the
 * published schema cannot drift away from the implementation.
 */
const expected = serializeSchema();
const actual = await readFile(schemaSnapshotPath, "utf8").catch(() => "");

if (actual !== expected) {
  console.error(
    "❌ The GraphQL SDL snapshot is out of date: the schema and the published contract drift apart.",
  );
  console.error(
    "   Regenerate it with `bun run --filter @opensaas/api graphql:generate` and commit the result.",
  );
  process.exit(1);
}

console.log("✅ The GraphQL SDL snapshot matches the schema.");
