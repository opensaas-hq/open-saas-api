# Security and Privacy

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 17. Security and Privacy

### 17.1 Trust boundaries

1. **Client → API**
   - Untrusted input: headers, JSON, query strings, GraphQL documents.
   - Validated at the edge with Zod or GraphQL validation.
2. **API → Better Auth**
   - Session cookie or bearer token verified by Better Auth.
3. **API → PostgreSQL**
   - Tenant-scoped queries; optional RLS enforcement.
4. **API → external ports**
   - The email adapter is pluggable; the payment port exists but the API
     currently hard-wires deny-all.
5. **Operator → process**
   - Environment variables and migrations/RLS scripts.

### 17.2 Authentication controls

- Password hashing delegated to Better Auth; plaintext passwords are never
  stored.
- Session cookies or bearer tokens.
- Session expiry and refresh age configurable.
- Password reset revokes sessions.
- Origin checks are always enabled, including tests.
- Custom `trustedOrigins` allowlist shared with CORS.
- Email verification is routed through `EmailSender` but is **not required**
  to sign in; the default sender discards it and the enforcement policy is
  pending.
- Better Auth rate limiting is enabled by default for auth route classes.
- No MFA, SSO, API-key management UI, or device management.

### 17.3 Authorization controls

- Tenant id only from `session.activeOrganizationId`.
- Membership required before any tenant route.
- Shared permission matrix for REST and GraphQL.
- Cross-tenant branch/contact ids → 404.
- Tenant repository functions require `organizationId` at the type level.
- RLS is available as defense in depth but is off by default.
- `audit_log`, `contacts`, and `branches` are the only RLS-protected tables.

### 17.4 Input and query safety

- Zod schemas validate bodies, params, and queries.
- SQL is parameterized through Drizzle.
- `ILIKE` search escapes `%`, `_`, and `\`, with explicit `ESCAPE '\'`.
- Metadata depth and serialized size are limited.
- GraphQL depth/cost limits and optional introspection block.
- Global body-size limit.
- Bulk contact count limit.
- UUID validation before repository access.

### 17.5 Secrets

- `BETTER_AUTH_SECRET` must be at least 32 characters.
- `DATABASE_URL` may contain credentials.
- `.env*` files are gitignored, but `.env.example` contains placeholder
  credentials.
- Logs redact authorization/cookie/password/token fields.
- Docker Compose ships a default auth secret fallback; production deployments
  must override it.
- No secret manager integration or rotation procedure exists.

### 17.6 PII and data handling

PII fields:

- `user`: name, email, image.
- `account`: provider ids, tokens, password hash.
- `session`: IP, user agent, browser/OS/device, language, timezone, country,
  city.
- `waitlist_entry`: email.
- `contacts`: name, phone, email, metadata (free-form, potentially PII), opt-in.
- `audit_log`: actor id, entity ids, before/after changes, metadata.
- `idempotency_keys`: stored response bodies for contact/registration writes.
- access logs: request id, tenant id, user id, path, status, timing.

Current privacy gaps:

- No GDPR/CCPA export, erasure, or consent-management endpoints.
- No retention policy for audit, idempotency, sessions, or logs.
- Deleting an organization cascades business rows but audit rows have no FK.
- Audit is append-only by convention, not enforced by database permissions or
  hash chaining.
- `metadata` can contain arbitrary PII; validation is structural, not content
  aware.
- Idempotency response bodies can retain PII for `IDEMPOTENCY_TTL_S`.
- Session telemetry persists client IP and device data without a documented
  retention period.
- Error responses mask internals, but logs can contain user-supplied identifiers.

### 17.7 Residual risks

- Proxy headers (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`) are
  trusted. If the API is directly reachable, clients can spoof their apparent
  IP for rate limiting and telemetry.
- In-memory rate limiting and membership caching do not coordinate across
  instances.
- RLS depends on a separate bootstrap that CI runs explicitly; production
  deployment does not run it automatically.
- The `opensaas_app` role must be created and granted correctly; boot checks
  only when `RLS_ENABLED=true`.
- Better Auth tables are not RLS-protected; a bug in session/tenant resolution
  is not contained by the database.
- GraphQL GET requests can be cached by intermediaries unless configured
  otherwise; the app does not set GraphQL-specific cache headers.
- No CSRF token is used beyond Better Auth's origin checks; cookie-authenticated
  project routes rely on the shared trusted-origin policy and JSON content type.
- No request signing or replay protection beyond optional idempotency keys.

---

## Related

- [Authentication](authentication.md)
- [Multi-tenancy](multi-tenancy.md)
- [Operations](operations.md)
- [Technical debt](../technical-debt.md)
