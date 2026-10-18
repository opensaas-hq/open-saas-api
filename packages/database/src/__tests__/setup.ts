import { beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

beforeEach(async () => {
  try {
    await db.execute(sql`
      TRUNCATE TABLE
        "contacts",
        "branch",
        "member",
        "invitation",
        "organization",
        "account",
        "session",
        "verification",
        "user"
      RESTART IDENTITY CASCADE;
    `);
  } catch {}
});
