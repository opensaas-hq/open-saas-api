import { describe, expect, test } from "bun:test";
import { REDACTED, SENSITIVE_KEYS, redact } from "../redact";

describe("@opensaas/core - redact", () => {
  test("redacts sensitive keys case-insensitively at the top level", () => {
    const input = {
      Authorization: "Bearer secret",
      Password: "hunter2",
      "Set-Cookie": "session=abc",
      keep: "visible",
    };

    const result = redact(input);

    expect(result).toEqual({
      Authorization: REDACTED,
      Password: REDACTED,
      "Set-Cookie": REDACTED,
      keep: "visible",
    });
  });

  test("redacts nested objects and arrays without mutating the input", () => {
    const input = {
      user: { name: "Ada", password: "hunter2" },
      requests: [{ token: "a" }, { token: "b" }],
    };
    const snapshot = JSON.stringify(input);

    const result = redact(input);

    expect(result.user).toEqual({ name: "Ada", password: REDACTED });
    expect(result.requests).toEqual([{ token: REDACTED }, { token: REDACTED }]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("leaves Error instances intact so stacks are preserved", () => {
    const error = new Error("boom");
    expect(redact(error)).toBe(error);
  });

  test("tolerates cyclic references without looping", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;

    const result = redact(node);

    expect(result.name).toBe("root");
    expect(result.self).toBe(node);
  });

  test("redacts HTTP header casing nested inside req/res objects", () => {
    const input = {
      req: { headers: { Authorization: "Bearer x", accept: "*/*" } },
      res: { headers: { "Set-Cookie": "session=abc" } },
    };

    const result = redact(input);

    expect(result.req.headers.Authorization).toBe(REDACTED);
    expect(result.res.headers["Set-Cookie"]).toBe(REDACTED);
  });

  test("uses a custom key set when provided", () => {
    const input = { secretField: "a", keep: "b" };
    const result = redact(input, ["secretField"]);

    expect(result).toEqual({ secretField: REDACTED, keep: "b" });
  });

  test("every SENSITIVE_KEYS entry is redacted regardless of casing", () => {
    for (const key of SENSITIVE_KEYS) {
      const result = redact({ [key.toUpperCase()]: "value" });
      expect(result[key.toUpperCase()]).toBe(REDACTED);
    }
  });
});
