import { writeFile } from "node:fs/promises";
import { serializeDocument, snapshotPath } from "./openapi-document";

/**
 * Write the OpenAPI snapshot of the API.
 *
 * The snapshot is committed so a reviewer sees the contract change in the
 * diff, and so CI can detect a drift between the routes and the published
 * contract (§4.10).
 */
const document = serializeDocument();
await writeFile(snapshotPath, document);

console.log(
  `✅ OpenAPI snapshot written: apps/api/openapi.json (${document.length} bytes)`,
);
