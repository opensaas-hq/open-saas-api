import { describe, expect, test } from "bun:test";
import { ForbiddenError, ValidationError } from "@opensaas/core";
import { validateRegistrationAccess } from "../registration-policy";

describe("@opensaas/auth - Registration Policy", () => {
  test("should allow immediate access in public mode", () => {
    const result = validateRegistrationAccess({
      mode: "public",
      email: "user@example.com",
    });
    expect(result.status).toBe("active");
  });

  test("should assign waitlist status in waiting_list mode", () => {
    const result = validateRegistrationAccess({
      mode: "waiting_list",
      email: "user@example.com",
    });
    expect(result.status).toBe("waitlist");
  });

  test("should require invite code in invite_code mode", () => {
    expect(() =>
      validateRegistrationAccess({
        mode: "invite_code",
        email: "user@example.com",
      }),
    ).toThrow(ValidationError);

    const result = validateRegistrationAccess({
      mode: "invite_code",
      email: "user@example.com",
      inviteCode: "VALID-INVITE-123",
    });
    expect(result.status).toBe("active");
  });

  test("should require payment proof in paid_required mode", () => {
    expect(() =>
      validateRegistrationAccess({
        mode: "paid_required",
        email: "user@example.com",
        hasPaid: false,
      }),
    ).toThrow(ForbiddenError);

    const result = validateRegistrationAccess({
      mode: "paid_required",
      email: "user@example.com",
      hasPaid: true,
    });
    expect(result.status).toBe("active");
  });
});
