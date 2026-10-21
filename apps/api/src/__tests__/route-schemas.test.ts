import { describe, expect, test } from "bun:test";
import { registerSchema } from "../routes/auth";
import { contactsQuerySchema, createContactSchema } from "../routes/contacts";

// These exercise the real Zod v4 schemas used by the routes, so a regression in
// validation (or a Zod upgrade) is caught without needing a database.

describe("Apps/API - registerSchema", () => {
  test("accepts a valid payload and trims the email", () => {
    const result = registerSchema.safeParse({
      email: "  user@example.com  ",
      password: "supersecret",
      name: "Ada",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.email).toBe("user@example.com");
  });

  test("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "supersecret",
      name: "Ada",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["email"]);
  });

  test("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "short",
      name: "Ada",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["password"]);
  });

  test("inviteCode is optional", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "supersecret",
      name: "Ada",
      inviteCode: "INVITE-1",
    });

    expect(result.success).toBe(true);
  });

  test("a client-supplied payment flag is not part of the schema (§3.2)", () => {
    const parsed = registerSchema.parse({
      email: "user@example.com",
      password: "supersecret",
      name: "Ada",
      hasPaid: true,
    });

    expect(parsed).not.toHaveProperty("hasPaid");
  });
});

describe("Apps/API - createContactSchema", () => {
  test("applies defaults for status, optIn and metadata", () => {
    const result = createContactSchema.parse({ name: "Grace" });

    expect(result.status).toBe("active");
    expect(result.optIn).toBe(true);
    expect(result.metadata).toEqual({});
  });

  test("accepts an empty-string email but rejects a malformed one", () => {
    expect(
      createContactSchema.safeParse({ name: "A", email: "" }).success,
    ).toBe(true);
    expect(
      createContactSchema.safeParse({ name: "A", email: "bad" }).success,
    ).toBe(false);
  });

  test("rejects a non-uuid branchId", () => {
    const result = createContactSchema.safeParse({
      name: "A",
      branchId: "not-a-uuid",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["branchId"]);
  });

  test("accepts arbitrary metadata under a string-keyed record", () => {
    const result = createContactSchema.safeParse({
      name: "A",
      metadata: { source: "import", count: 3 },
    });

    expect(result.success).toBe(true);
  });
});

describe("Apps/API - contactsQuerySchema", () => {
  test("coerces numeric query strings and applies paging defaults", () => {
    const result = contactsQuerySchema.parse({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  test("coerces page/limit from strings", () => {
    const result = contactsQuerySchema.parse({ page: "2", limit: "50" });

    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
  });

  test("rejects a limit above the maximum", () => {
    const result = contactsQuerySchema.safeParse({ limit: "101" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["limit"]);
  });

  test("rejects an unknown status", () => {
    const result = contactsQuerySchema.safeParse({ status: "bogus" });

    expect(result.success).toBe(false);
  });
});
