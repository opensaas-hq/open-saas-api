import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkDatabaseHealth } from "../health";
import { assertTestDatabase } from "./guard";

describe("@opensaas/database - Health probe", () => {
  beforeAll(assertTestDatabase);

  test("reports the real connection state (true against a live database)", async () => {
    expect(await checkDatabaseHealth()).toBe(true);
  });

  test("returns false when the probe exceeds the timeout", async () => {
    // A probe that never resolves must be reported as down once the timeout
    // elapses, proving the result depends on the real probe and not a stub.
    const hung = {
      execute: () => new Promise<never>(() => {}),
    };

    expect(await checkDatabaseHealth({ timeoutMs: 5, db: hung })).toBe(false);
  });

  test("defaults to DB_BREAKER_PROBE_TIMEOUT_MS when no timeout is given", () => {
    // Run in a subprocess with a tiny env budget so a hung probe returns false
    // quickly, proving the default timeout comes from the validated env knob.
    const entry = join(import.meta.dir, "..", "health.ts");
    const script = `
      const { checkDatabaseHealth } = await import(${JSON.stringify(entry)});
      const hung = { execute: () => new Promise(() => {}) };
      const started = Date.now();
      const healthy = await checkDatabaseHealth({ db: hung });
      process.stdout.write(JSON.stringify({ healthy, elapsed: Date.now() - started }));
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        DB_BREAKER_PROBE_TIMEOUT_MS: "20",
        DATABASE_URL:
          process.env.DATABASE_URL_TEST ??
          "postgresql://user:pass@localhost:5432/db",
      },
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      healthy: boolean;
      elapsed: number;
    };
    expect(output.healthy).toBe(false);
    // Bounded by the 20 ms knob, not the 2000 ms fallback.
    expect(output.elapsed).toBeLessThan(1_000);
  });

  test("returns false when the probe rejects", async () => {
    const failing = {
      execute: () => Promise.reject(new Error("connection refused")),
    };

    expect(await checkDatabaseHealth({ db: failing })).toBe(false);
  });
});
