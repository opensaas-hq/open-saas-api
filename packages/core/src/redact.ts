/**
 * Field names whose values must never reach logs or audit payloads. Matched
 * case-insensitively and at any depth, so `Authorization`, `Set-Cookie`,
 * `user.password`, etc. are all covered. Single source of truth shared by the
 * logger and the audit diff (see the audit port).
 */
export const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "set-cookie",
] as const;

export type SensitiveKey = (typeof SENSITIVE_KEYS)[number];

/** Replacement written in place of any sensitive value. */
export const REDACTED = "[REDACTED]";

/**
 * Redact sensitive keys from a plain object, recursively, returning a new
 * value and never mutating the input. This is the single redaction mechanism:
 * the logger applies it in pino's `formatters.log` hook, and non-logger
 * consumers — the audit diff — reuse the exact same rules.
 *
 * Matching is case-insensitive and applies at any depth, so `Authorization`,
 * `Set-Cookie`, `req.headers.authorization` and nested payloads are covered.
 * Arrays are preserved as arrays; cycles are handled by tracking visited
 * objects so a self-referencing payload cannot loop forever.
 */
export const redact = <T>(
  value: T,
  keys: readonly string[] = SENSITIVE_KEYS,
  seen: WeakSet<object> = new WeakSet(),
): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Error) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, keys, seen)) as T;
  }

  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    result[key] = normalized.has(key.toLowerCase())
      ? REDACTED
      : redact(entry, keys, seen);
  }

  return result as T;
};
