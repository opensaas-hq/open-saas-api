import { beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

/**
 * Truncate every table before each test so suites start from a clean slate.
 * Table names must match `schema.ts` exactly (business tables first, then the
 * Better Auth tables the business rows reference).
 */
beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE
      "audit_log",
      "contacts",
      "branches",
      "member",
      "invitation",
      "organization",
      "account",
      "session",
      "verification",
      "user"
      RESTART IDENTITY CASCADE;
  `);
});
