import { describe, expect, test } from "bun:test";
import { initConfig, resetConfig } from "@opensaas/core";
import {
  getDisposableDomains,
  isDisposableEmail,
  normalizeEmail,
  parseDomainList,
  validateAndNormalizeEmail,
} from "../email-policy";

const baseConfig = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/opensaas",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

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

  describe("parseDomainList()", () => {
    test("normalizes, trims and drops blanks", () => {
      expect(parseDomainList("  Burner.COM , , Temp.org ")).toEqual([
        "burner.com",
        "temp.org",
      ]);
    });

    test("returns an empty list for undefined or blank input", () => {
      expect(parseDomainList(undefined)).toEqual([]);
      expect(parseDomainList("   ")).toEqual([]);
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

    test("blocks env-configured domains merged with the built-ins", () => {
      const domains = getDisposableDomains(
        "custom-burner.com, another-temp.org",
      );
      expect(domains.has("custom-burner.com")).toBe(true);
      expect(domains.has("another-temp.org")).toBe(true);
      expect(domains.has("mailinator.com")).toBe(true);
      expect(isDisposableEmail("user@custom-burner.com", domains)).toBe(true);
    });
  });

  describe("validateAndNormalizeEmail()", () => {
    test("should reject disposable email with ValidationError", () => {
      expect(() => validateAndNormalizeEmail("spammer@mailinator.com")).toThrow(
        "Disposable/temporary email addresses are not allowed",
      );
    });

    test("should return normalized email for valid addresses", () => {
      const normalized = validateAndNormalizeEmail(
        "  John.Doe+Alias@Gmail.com ",
      );
      expect(normalized).toBe("johndoe@gmail.com");
    });

    // §3.6 AC2: an env-provided domain blocks registration through the same
    // 422 DISPOSABLE_EMAIL_REJECTED path as a built-in, reading validated config.
    test("an env-provided domain is blocked via validated config (no process.env)", () => {
      initConfig({
        ...baseConfig,
        DISPOSABLE_EMAIL_DOMAINS: "custom-burner.com",
      });
      try {
        const domains = getDisposableDomains();
        expect(domains.has("custom-burner.com")).toBe(true);
        expect(() =>
          validateAndNormalizeEmail("user@custom-burner.com"),
        ).toThrow("Disposable/temporary email addresses are not allowed");
      } finally {
        // Restore the real process configuration so a shared-process test run
        // (TD-11) rebuilds a valid config for later suites.
        resetConfig();
        initConfig();
      }
    });
  });
});
