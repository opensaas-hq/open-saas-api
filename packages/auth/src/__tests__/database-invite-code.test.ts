import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createRegistrationCode,
  getRegistrationCode,
  withRawTransaction,
} from "@opensaas/database";
import type { RegistrationContext } from "../registration/types";
import { createDatabaseInviteCodeValidator } from "../registration/validators/database-invite-code";

const context: RegistrationContext = {
  mode: "invite_code",
  email: "invitee@example.com",
};

const validator = createDatabaseInviteCodeValidator();

const hasDatabase =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb("@opensaas/auth - DB-backed invite validation (§3.2)", () => {
  beforeEach(async () => {
    await withRawTransaction(async (tx) => {
      await tx.execute(
        'TRUNCATE TABLE registration_code, "user" RESTART IDENTITY CASCADE',
      );
    });
  });

  afterAll(async () => {
    const { close } = await import("@opensaas/database");
    await close();
  });

  test("reports not_found for an unknown code", async () => {
    const result = await validator.check("NOPE", context);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("INVALID_INVITE_CODE");
  });

  test("reports expired for a past-expiry code", async () => {
    await createRegistrationCode({
      code: "EXP",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const result = await validator.check("EXP", context);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("INVITE_CODE_EXPIRED");
  });

  test("reports already-used for a consumed code", async () => {
    await createRegistrationCode({ code: "USED" });
    await withRawTransaction(async (tx) => {
      const { consumeRegistrationCode } = await import("@opensaas/database");
      await consumeRegistrationCode({ code: "USED", tx });
    });
    const result = await validator.check("USED", context);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("INVITE_CODE_ALREADY_USED");
  });

  test("accepts a valid code and consumes it exactly once inside a transaction", async () => {
    await createRegistrationCode({ code: "GOOD" });

    // `consumed_by_user_id` is an FK to `user`, so a real user must exist.
    await withRawTransaction(async (tx) => {
      await tx.execute(
        "INSERT INTO \"user\" (id, name, email) VALUES ('user_1', 'U', 'u@example.com')",
      );
    });

    const check = await validator.check("GOOD", context);
    expect(check.valid).toBe(true);
    if (!check.valid) return;

    await withRawTransaction(async (tx) => {
      await check.consume("user_1", tx);
    });

    const after = await getRegistrationCode({ code: "GOOD" });
    expect(after?.status).toBe("consumed");
    expect(after?.useCount).toBe(1);
  });
});
