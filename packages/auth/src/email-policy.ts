import { ValidationError } from "@opensaas/core";

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

export function getDisposableDomains(): Set<string> {
  const domains = new Set(BASE_DISPOSABLE_DOMAINS);

  const envDomains = process.env.DISPOSABLE_EMAIL_DOMAINS;
  if (envDomains && envDomains.trim() !== "") {
    for (const d of envDomains.split(",")) {
      const clean = d.trim().toLowerCase();
      if (clean) domains.add(clean);
    }
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

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;

  const disposableSet = getDisposableDomains();
  return disposableSet.has(domain);
}

export function validateAndNormalizeEmail(email: string): string {
  if (isDisposableEmail(email)) {
    throw new ValidationError(
      "Disposable/temporary email addresses are not allowed. Please use a permanent email address.",
      { field: "email", code: "DISPOSABLE_EMAIL_REJECTED" },
    );
  }

  return normalizeEmail(email);
}
