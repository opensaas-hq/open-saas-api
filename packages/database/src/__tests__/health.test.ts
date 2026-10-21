import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../client";
import { probeDatabase } from "../client/health";
import { assertTestDatabase } from "./guard";

describe("@opensaas/database - Health probe", () => {
  beforeAll(assertTestDatabase);

  test("reports the real connection state (true against a live database)", async () => {
    expect(await probeDatabase({ db, timeoutMs: 2_000 })).toBe(true);
  });

  test("returns false when the probe exceeds the timeout", async () => {
    // A probe that never resolves must be reported as down once the timeout
    // elapses, proving the result depends on the real probe and not a stub.
    const hung = {
      execute: () => new Promise<never>(() => {}),
    };

    expect(await probeDatabase({ timeoutMs: 5, db: hung })).toBe(false);
  });

  test("returns false when the probe rejects", async () => {
    const failing = {
      execute: () => Promise.reject(new Error("connection refused")),
    };

    expect(await probeDatabase({ timeoutMs: 50, db: failing })).toBe(false);
  });

  test("the probe reads no environment variable (§4.6)", () => {
    // The readiness probe must report the real state of the database: a
    // branch on the environment could report a healthy database that is down.
    // The timeout is injected by the caller, so the probe reads nothing.
    const source = readFileSync(
      join(import.meta.dir, "..", "client", "health.ts"),
      "utf8",
    );

    expect(source).not.toContain("process.env");
    expect(source).not.toContain("NODE_ENV");
  });
});
