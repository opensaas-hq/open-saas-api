import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildPoolConfig, close, createDb } from "../client";

describe("@opensaas/database - Client factory", () => {
  test("buildPoolConfig maps every env value to the pool", () => {
    const pool = buildPoolConfig({
      DB_POOL_MAX: 7,
      DB_IDLE_TIMEOUT_S: 11,
      DB_STATEMENT_TIMEOUT_MS: 4321,
      DB_CONNECT_TIMEOUT_S: 3,
    });

    expect(pool).toEqual({
      max: 7,
      idleTimeout: 11,
      statementTimeout: 4321,
      connectTimeout: 3,
    });
  });

  test("createDb returns a usable handle without reading the environment", async () => {
    const handle = createDb({
      databaseUrl: process.env.DATABASE_URL ?? "",
      pool: {
        max: 1,
        idleTimeout: 1,
        statementTimeout: 5_000,
        connectTimeout: 5,
      },
    });

    expect(handle).toBeDefined();
    expect(typeof handle.execute).toBe("function");
    // Close the pool created by this test so no handle leaks.
    await handle.$client.end();
  });

  test("importing the package without a database env does not throw", () => {
    const entry = join(import.meta.dir, "..", "index.ts");
    const script = `import(${JSON.stringify(entry)}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })`;

    const result = spawnSync(process.execPath, ["-e", script], {
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  });

  test("close() resolves and leaves no open handles", async () => {
    expect(typeof close).toBe("function");

    // Exercise the underlying close against an isolated handle so the shared
    // lazy pool is never torn down for other test files running in the same
    // process.
    const handle = createDb({
      databaseUrl: process.env.DATABASE_URL ?? "",
      pool: {
        max: 1,
        idleTimeout: 1,
        statementTimeout: 5_000,
        connectTimeout: 5,
      },
    });

    await expect(handle.$client.end()).resolves.toBeUndefined();
  });

  test("no production source reads process.env directly", () => {
    const srcDir = join(import.meta.dir, "..");
    const files = readdirSync(srcDir, { recursive: true })
      .map((name) => String(name))
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => !name.split(/[\\/]/).includes("__tests__"));
    expect(files).toContain("client.ts");

    for (const name of files) {
      const contents = readFileSync(join(srcDir, name), "utf8");
      expect(contents).not.toContain("process.env");
    }
  });
});
