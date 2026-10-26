import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * The deprecated paths and the versioned path that replaces each of them.
 *
 * The old paths keep working — a client that was written before the
 * versioning must not break — but they announce their own end: every response
 * carries the `Deprecation` and `Sunset` headers (RFC 8594) and the `Link`
 * header that points to the successor (RFC 8288).
 */
export const LEGACY_ALIASES = [
  { legacy: "/api/contacts", successor: "/api/v1/contacts" },
  { legacy: "/api/branches", successor: "/api/v1/branches" },
  { legacy: "/api/registration", successor: "/api/v1/registration" },
  { legacy: "/api/health", successor: "/readyz" },
] as const;

/**
 * The moment the deprecated paths stop being served.
 *
 * The date is published in the `Sunset` header of every deprecated response,
 * so a client can decide when to migrate without reading the documentation.
 */
export const LEGACY_SUNSET = "Wed, 31 Mar 2027 23:59:59 GMT";

/**
 * Find the deprecated alias a path belongs to, if any.
 *
 * A path belongs to an alias when it is the alias itself or one of its
 * children (`/api/contacts` and `/api/contacts/42`).
 */
export const findLegacyAlias = (
  path: string,
): (typeof LEGACY_ALIASES)[number] | undefined =>
  LEGACY_ALIASES.find(
    ({ legacy }) => path === legacy || path.startsWith(`${legacy}/`),
  );

/**
 * Build the middleware that marks the deprecated paths as deprecated.
 *
 * The headers are added to the response of every request that hits a
 * deprecated path, whatever its status: a client that is told the path is
 * deprecated must be told even when the call failed.
 */
export const createLegacyDeprecationMiddleware =
  (): MiddlewareHandler<AppEnv> => async (c, next) => {
    const alias = findLegacyAlias(c.req.path);

    if (alias) {
      c.header("Deprecation", "true");
      c.header("Sunset", LEGACY_SUNSET);
      c.header("Link", `<${alias.successor}>; rel="successor-version"`);
    }

    await next();
  };
