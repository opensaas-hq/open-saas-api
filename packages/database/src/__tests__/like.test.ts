import { describe, expect, test } from "bun:test";
import { escapeLikePattern, toContainsLikePattern } from "../repositories/like";

describe("@opensaas/database - LIKE pattern escaping", () => {
  test("escapes the wildcard and escape characters", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });

  test("leaves ordinary text unchanged", () => {
    expect(escapeLikePattern("Ada Lovelace")).toBe("Ada Lovelace");
    expect(escapeLikePattern("a@b.co")).toBe("a@b.co");
  });

  test("handles unicode input without corrupting it", () => {
    expect(escapeLikePattern("José 東京 🙂")).toBe("José 東京 🙂");
    expect(escapeLikePattern("café_%")).toBe("café\\_\\%");
  });

  test("wraps the escaped input for a contains match", () => {
    expect(toContainsLikePattern("100%")).toBe("%100\\%%");
    expect(toContainsLikePattern("plain")).toBe("%plain%");
  });
});
