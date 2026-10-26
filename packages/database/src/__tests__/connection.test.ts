import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";
import { assertTestDatabase } from "./guard";

describe("Database Real Connection", () => {
  beforeAll(assertTestDatabase);

  test("should connect successfully to PostgreSQL / Supabase", async () => {
    const result = await db.execute(sql`SELECT 1 as connected`);
    expect(result[0]?.connected).toBe(1);
  });
});
