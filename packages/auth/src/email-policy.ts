import { ValidationError, getEnv } from "@opensaas/core";

/** Built-in disposable/temporary email domains, always blocked. */
const BASE_DISPOSABLE_DOMAINS = [
  "mailinator.com",
  "10minutemail.com",
  "tempmail.com",
  "guerrillamail.com",
  "trashmail.com",
  "yopmail.com",
  "dispostable.com",
  "getnada.com",
  "throwawaymail.com",
];

/**
 * Parse a comma-separated list of domains, normalized to lowercase and stripped
 * of blanks. Accepts an already-parsed string or `undefined`.
 */
export const parseDomainList = (raw: string | undefined): string[] => {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
};

/**
 * The effective disposable-domain blocklist: the built-ins merged with any
 * domains configured through `DISPOSABLE_EMAIL_DOMAINS`. The configured value
 * is read from the **validated** config (`getEnv`), never raw `process.env`, so
 * there is a single source of truth (§3.6).
 */
export function getDisposableDomains(
  configured: string | undefined = getEnv().DISPOSABLE_EMAIL_DOMAINS,
): Set<string> {
  const domains = new Set(BASE_DISPOSABLE_DOMAINS);
  for (const domain of parseDomainList(configured)) {
    domains.add(domain);
  }
  return domains;
}

/**
 * - "Hola.User+test1@Gmail.com" -> "holauser@gmail.com"
 * - "user+alias@outlook.com"    -> "user@outlook.com"
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [localPart, domain] = trimmed.split("@");

  if (!localPart || !domain) {
    return trimmed;
  }

  const baseLocal = localPart.split("+")[0];

  const cleanLocal =
    domain === "gmail.com" || domain === "googlemail.com"
      ? baseLocal.replace(/\./g, "")
      : baseLocal;

  return `${cleanLocal}@${domain}`;
}

export function isDisposableEmail(
  email: string,
  disposableDomains: Set<string> = getDisposableDomains(),
): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;

  return disposableDomains.has(domain);
}

/**
 * Validate an email against the disposable-domain blocklist and return its
 * normalized form.
 *
 * The blocklist is injectable so a caller that owns a validated configuration
 * can pass exactly that list, instead of relying on the process-wide env
 * (§4.7). The default keeps the standalone behavior for direct callers.
 */
export function validateAndNormalizeEmail(
  email: string,
  disposableDomains: Set<string> = getDisposableDomains(),
): string {
  if (isDisposableEmail(email, disposableDomains)) {
    throw new ValidationError(
      "Disposable/temporary email addresses are not allowed. Please use a permanent email address.",
      { field: "email", code: "DISPOSABLE_EMAIL_REJECTED" },
    );
  }

  return normalizeEmail(email);
}
