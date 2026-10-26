import { readFile } from "node:fs/promises";
import { serializeDocument, snapshotPath } from "./openapi-document";

/**
 * Check that the committed OpenAPI snapshot matches the routes.
 *
 * This is the drift check of CI (§4.10): when a route, a schema or a response
 * changes without the snapshot being regenerated, the check fails and the
 * contract cannot drift away from the implementation.
 */
const expected = serializeDocument();
const actual = await readFile(snapshotPath, "utf8").catch(() => "");

if (actual !== expected) {
  console.error(
    "❌ The OpenAPI snapshot is out of date: the routes and the published contract drift apart.",
  );
  console.error(
    "   Regenerate it with `bun run --filter @opensaas/api openapi:generate` and commit the result.",
  );
  process.exit(1);
}

console.log("✅ The OpenAPI snapshot matches the routes.");
