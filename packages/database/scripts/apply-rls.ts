import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Apply one of the RLS bootstrap scripts (`rls-setup.sql` / `rls-teardown.sql`)
 * against `DATABASE_URL`.
 *
 * This is not a migration runner: there is no released schema yet, so the RLS
 * bootstrap is applied explicitly by the test/CI job (and later by a documented
 * deploy step). See docs/architecture/multitenancy.md.
 *
 * Usage: bun --env-file=../../.env.test scripts/apply-rls.ts setup|teardown
 */
const direction = process.argv[2];

if (direction !== "setup" && direction !== "teardown") {
  console.error("Usage: apply-rls.ts <setup|teardown>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to apply RLS scripts.");
  process.exit(1);
}

const file = join(
  import.meta.dir,
  "..",
  "sql",
  direction === "setup" ? "rls-setup.sql" : "rls-teardown.sql",
);

const sql = postgres(databaseUrl, { max: 1 });

try {
  // `unsafe` is required because the file holds multiple statements, including
  // DO blocks; it is a trusted, repository-owned script.
  await sql.unsafe(readFileSync(file, "utf8"));
  console.log(`RLS ${direction} applied: ${file}`);
} finally {
  await sql.end();
}
