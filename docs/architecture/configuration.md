# Configuration

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 6. Configuration

All application configuration is declared in
`packages/core/src/config.ts` and parsed by Zod. The canonical type is `Env`.

### 6.1 Validation behavior

- `createEnv(source)` parses a provided record; throws `ConfigError` on failure.
- `getEnv()` lazily parses and memoizes `process.env`.
- `initConfig(source)` is the boot-only initializer that prints a structured
  failure and exits.
- Empty strings are treated as unset only for selected variables
  (`REGISTRATION_MODE`, `GRAPHQL_INTROSPECTION_ENABLED`).
- Booleans accept actual booleans or the exact strings `"true"` / `"false"`;
  `"false"` correctly becomes `false`.
- `DATABASE_URL` must use `postgres://` or `postgresql://` and be a valid URL.
- `BETTER_AUTH_SECRET` must be at least 32 characters.
- `BETTER_AUTH_URL` must be a valid URL.

### 6.2 Environment variables

| Variable | Default | Consumer / meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | Logger pretty mode, GraphQL introspection default |
| `PORT` | `3000` | `Bun.serve` port |
| `LOG_LEVEL` | `info` | Pino level |
| `DATABASE_URL` | required | Runtime PostgreSQL connection |
| `DATABASE_URL_TEST` | unset | Test isolation guard only; never read by app code |
| `BETTER_AUTH_SECRET` | required, ≥32 chars | Better Auth signing/encryption |
| `BETTER_AUTH_URL` | required URL | Better Auth base URL; always trusted origin |
| `DB_POOL_MAX` | `10` | postgres.js pool max |
| `DB_IDLE_TIMEOUT_S` | `20` | Idle connection timeout |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | Server-side statement timeout |
| `DB_CONNECT_TIMEOUT_S` | `10` | Initial connection timeout |
| `DB_RETRY_MAX_ATTEMPTS` | `5` | Retry attempts including first |
| `DB_RETRY_BASE_DELAY_MS` | `100` | Exponential backoff base |
| `DB_RETRY_MAX_DELAY_MS` | `5000` | Backoff ceiling |
| `DB_BREAKER_ENABLED` | `true` | Enables circuit breaker for resilient executor |
| `DB_BREAKER_FAILURE_THRESHOLD` | `5` | Consecutive failures to open |
| `DB_BREAKER_COOLDOWN_MS` | `10000` | Time open before half-open |
| `DB_BREAKER_PROBE_TIMEOUT_MS` | `2000` | Half-open probe budget |
| `RLS_ENABLED` | `false` | Connect as `opensaas_app` and set tenant GUC |
| `DISPOSABLE_EMAIL_DOMAINS` | unset | Extra comma-separated blocked domains |
| `TRUSTED_ORIGINS` | unset | Extra CORS/CSRF origins |
| `AUTH_RATE_LIMIT_ENABLED` | `true` | Better Auth rate limiter |
| `AUTH_RATE_LIMIT_WINDOW_S` | `60` | Better Auth window |
| `AUTH_RATE_LIMIT_MAX` | `100` | Better Auth max per route class |
| `SESSION_EXPIRES_IN_S` | `604800` (7 days) | Absolute session lifetime |
| `SESSION_UPDATE_AGE_S` | `86400` (1 day) | Session refresh interval |
| `MEMBERSHIP_CACHE_TTL_S` | `30` | In-memory role cache TTL; `0` disables |
| `BODY_SIZE_LIMIT_BYTES` | `1048576` (1 MiB) | Global request body limit |
| `BULK_MAX_CONTACTS` | `1000` | Bulk import maximum |
| `HEALTH_PROBE_TIMEOUT_MS` | `2000` | Readiness DB probe timeout |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `15000` | Graceful drain budget |
| `IDEMPOTENCY_TTL_S` | `86400` (24 h) | Stored response replay TTL |
| `WRITE_RATE_LIMIT_ENABLED` | `true` | Project write rate limiter |
| `WRITE_RATE_LIMIT_WINDOW_S` | `60` | Write limiter window |
| `WRITE_RATE_LIMIT_MAX` | `30` | Writes per method/IP/window |
| `GRAPHQL_MAX_DEPTH` | `10` | GraphQL selection depth |
| `GRAPHQL_MAX_COMPLEXITY` | `500` | GraphQL selected-field count |
| `GRAPHQL_INTROSPECTION_ENABLED` | unset | `undefined` → enabled outside production; explicit bool overrides |
| `REGISTRATION_MODE` | `public` | `public`, `waiting_list`, `invite_code`, `paid_required` |

### 6.3 `.env.example` problems

`.env.example` is not a reliable contract today:

- `DATABASE_URL_TEST` is declared twice with different values.
- `RLS_ENABLED` is declared twice.
- `GRAPHQL_MAX_DEPTH` is declared twice with the same value.
  `GRAPHQL_MAX_COMPLEXITY` (500/1000) and `GRAPHQL_INTROSPECTION_ENABLED`
  (`""`/`true`) are declared twice with conflicting values.
- It documents `DB_CIRCUIT_BREAKER_FAILURE_THRESHOLD`,
  `DB_CIRCUIT_BREAKER_COOLDOWN_MS`, and `DB_CIRCUIT_BREAKER_PROBE_TIMEOUT_MS`,
  but the code reads `DB_BREAKER_*`. The former are ignored.
- `docker-compose.yml` sets `CORS_ORIGINS`, which the code never reads. The
  supported variable is `TRUSTED_ORIGINS`.

Use `packages/core/src/config.ts` as the authoritative list.

---

## Related

- [Overview](overview.md)
- [Operations](operations.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
