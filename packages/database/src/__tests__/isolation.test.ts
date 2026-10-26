import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertTestDatabase } from "./guard";

describe("@opensaas/database - Test isolation guard", () => {
  test("passes when DATABASE_URL is the dedicated test database", () => {
    expect(() => assertTestDatabase()).not.toThrow();
  });

  test("fails loudly when DATABASE_URL is not DATABASE_URL_TEST", () => {
    // Run in a subprocess so we can point DATABASE_URL at something else
    // without disturbing this process's environment.
    const entry = join(import.meta.dir, "guard.ts");
    const script = `
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/dev";
      process.env.DATABASE_URL_TEST = "postgresql://user:pass@localhost:5432/test";
      const { assertTestDatabase } = await import(${JSON.stringify(entry)});
      assertTestDatabase();
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL is not DATABASE_URL_TEST");
  });

  test("fails when DATABASE_URL_TEST is unset", () => {
    const entry = join(import.meta.dir, "guard.ts");
    const script = `
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/dev";
      delete process.env.DATABASE_URL_TEST;
      const { assertTestDatabase } = await import(${JSON.stringify(entry)});
      assertTestDatabase();
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL is not DATABASE_URL_TEST");
  });
});
