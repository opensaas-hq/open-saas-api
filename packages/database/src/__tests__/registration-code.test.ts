import { describe, expect, test } from "bun:test";
import {
  consumeRegistrationCode,
  countPendingRegistrationCodes,
  createRegistrationCode,
  getRegistrationCode,
} from "../repositories/registration-code";
import { useTestDatabase } from "./setup";

useTestDatabase();

describe("@opensaas/database - Registration code repository", () => {
  const suffix = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  test("creates a pending single-use code by default", async () => {
    const code = `CODE-${suffix()}`;
    const row = await createRegistrationCode({ code });

    expect(row?.code).toBe(code);
    expect(row?.status).toBe("pending");
    expect(row?.maxUses).toBe(1);
    expect(row?.useCount).toBe(0);
  });

  test("consumes a valid code exactly once", async () => {
    const code = `CODE-${suffix()}`;
    await createRegistrationCode({ code });

    const first = await consumeRegistrationCode({ code });
    expect(first.consumed).toBe(true);

    const after = await getRegistrationCode({ code });
    expect(after?.status).toBe("consumed");
    expect(after?.useCount).toBe(1);
  });

  test("rejects a second consumption of a single-use code", async () => {
    const code = `CODE-${suffix()}`;
    await createRegistrationCode({ code });

    await consumeRegistrationCode({ code });
    const second = await consumeRegistrationCode({ code });

    expect(second).toEqual({ consumed: false, reason: "not_pending" });
  });

  test("consumes exactly maxUses times for a multi-use code", async () => {
    const code = `CODE-${suffix()}`;
    await createRegistrationCode({ code, maxUses: 2 });

    expect((await consumeRegistrationCode({ code })).consumed).toBe(true);
    expect((await consumeRegistrationCode({ code })).consumed).toBe(true);
    expect((await consumeRegistrationCode({ code })).consumed).toBe(false);

    const after = await getRegistrationCode({ code });
    expect(after?.status).toBe("consumed");
    expect(after?.useCount).toBe(2);
  });

  test("reports not_found for an unknown code", async () => {
    const result = await consumeRegistrationCode({ code: "DOES-NOT-EXIST" });
    expect(result).toEqual({ consumed: false, reason: "not_found" });
  });

  test("rejects an expired code", async () => {
    const code = `CODE-${suffix()}`;
    await createRegistrationCode({
      code,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await consumeRegistrationCode({ code });
    expect(result).toEqual({ consumed: false, reason: "expired" });
  });

  test("counts only pending, non-expired codes", async () => {
    await createRegistrationCode({ code: `P1-${suffix()}` });
    await createRegistrationCode({ code: `P2-${suffix()}` });
    await createRegistrationCode({
      code: `E1-${suffix()}`,
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(await countPendingRegistrationCodes()).toBe(2);
  });

  test("consumes exactly once under concurrent requests", async () => {
    const code = `CODE-${suffix()}`;
    await createRegistrationCode({ code });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeRegistrationCode({ code })),
    );

    const consumed = results.filter((r) => r.consumed);
    expect(consumed).toHaveLength(1);
  });
});
