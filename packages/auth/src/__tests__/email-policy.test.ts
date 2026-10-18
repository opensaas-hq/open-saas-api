import { describe, expect, test } from "bun:test";
import { ValidationError } from "@opensaas/core";
import {
  isDisposableEmail,
  normalizeEmail,
  validateAndNormalizeEmail,
} from "../email-policy";

describe("@opensaas/auth - Email Policy & Anti-Abuse", () => {
  describe("normalizeEmail()", () => {
    test("should strip plus aliases and convert to lowercase", () => {
      expect(normalizeEmail("User+Tag123@Domain.com")).toBe("user@domain.com");
      expect(normalizeEmail("ALICE+promo@COMPANY.CO")).toBe("alice@company.co");
    });

    test("should strip dots for gmail accounts", () => {
      expect(normalizeEmail("j.o.h.n.d.o.e@gmail.com")).toBe(
        "johndoe@gmail.com",
      );
      expect(normalizeEmail("john.doe+test@gmail.com")).toBe(
        "johndoe@gmail.com",
      );
    });

    test("should preserve dots for non-gmail domain local parts", () => {
      expect(normalizeEmail("john.doe+test@outlook.com")).toBe(
        "john.doe@outlook.com",
      );
    });
  });

  describe("isDisposableEmail()", () => {
    test("should identify disposable domains", () => {
      expect(isDisposableEmail("test@mailinator.com")).toBe(true);
      expect(isDisposableEmail("user@10minutemail.com")).toBe(true);
      expect(isDisposableEmail("user@tempmail.com")).toBe(true);
    });

    test("should allow valid standard email domains", () => {
      expect(isDisposableEmail("user@gmail.com")).toBe(false);
      expect(isDisposableEmail("contact@opensaas.org")).toBe(false);
    });

    test("should block custom disposable domains passed via DISPOSABLE_EMAIL_DOMAINS env var", () => {
      process.env.DISPOSABLE_EMAIL_DOMAINS =
        "custom-burner.com, another-temp.org";

      expect(isDisposableEmail("user@custom-burner.com")).toBe(true);
      expect(isDisposableEmail("user@another-temp.org")).toBe(true);

      process.env.DISPOSABLE_EMAIL_DOMAINS = undefined;
    });
  });

  describe("validateAndNormalizeEmail()", () => {
    test("should reject disposable email with ValidationError", () => {
      expect(() => validateAndNormalizeEmail("spammer@mailinator.com")).toThrow(
        ValidationError,
      );
    });

    test("should return normalized email for valid addresses", () => {
      const normalized = validateAndNormalizeEmail(
        "  John.Doe+Alias@Gmail.com ",
      );
      expect(normalized).toBe("johndoe@gmail.com");
    });
  });
});
