import { beforeAll, describe, expect, test } from "bun:test";
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

  test("returns false when the probe rejects", async () => {
    const failing = {
      execute: () => Promise.reject(new Error("connection refused")),
    };

    expect(await checkDatabaseHealth({ db: failing })).toBe(false);
  });
});
