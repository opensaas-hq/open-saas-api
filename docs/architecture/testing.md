# Testing Strategy

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 18. Testing Strategy

### 18.1 Runner and commands

- Runner: `bun:test`.
- Root:
  - `bun test` — all tests
  - `bun run test:unit` — name-pattern selection with a fallback to unit paths
  - `bun run test:integration` — `apps` + `packages`, excluding `*.unit.*`
  - `bun run lint` — Biome check
  - `bun run typecheck` — every workspace
- Database package:
  - `bun run test` / `test:integration` load `.env.test`
  - `test:unit` runs only `like` and `resilience`

### 18.2 Database isolation

`assertTestDatabase()`:

- Drops memoized config/DB handles.
- Refuses to run unless `DATABASE_URL === DATABASE_URL_TEST`.
- The error explicitly tells the developer to use `.env.test`.

`useTestDatabase()`:

- Runs the guard in `beforeAll`.
- Truncates all tables in `beforeEach`.
- Truncates and closes the pool in `afterAll`.

`TRUNCATE_ALL` covers every table except `idempotency_keys`, including Better
Auth and operational tables, and restarts identities. Suites that exercise
idempotency truncate that table separately.

App-level tests reuse the same guard through `hasTestDatabase()` and the
`createTestApp` helper. Suites that need a real DB skip when it is absent; the
guard is the hard stop for packages that always require one.

### 18.3 Test helpers

`apps/api/src/__tests__/support/app.ts`:

- Builds an app with synthetic env overrides.
- Uses the real test DB handle.
- Disables write rate limiting by default.
- Runs with RLS off by default.
- `signUp`, `signIn`, `createOrganization`, `createTenant`.
- `cookieHeader` extracts session cookies.
- `jsonHeaders` adds the trusted test origin.
- `createLogCapture` captures serialized Pino lines.
- Supports injected DB, breaker, lifecycle, and logger destination.

### 18.4 Coverage by area

**Core**

- `audit.test.ts`: diffs, redaction, recording ports.
- `config.test.ts`: env validation.
- `errors.test.ts`: error classes/status mapping.
- `logger.test.ts`: redaction and request bindings.
- `redact.test.ts`: recursive/case-insensitive behavior.
- `response.test.ts`: envelopes.

**Auth**

- `auth-hardening.test.ts`: origin checks, rate limits, session policy.
- `database-invite-code.test.ts`: invite validation/consumption.
- `email-policy.test.ts`: normalization and disposable domains.
- `registration-flow.test.ts`: transactional registration.
- `registration-registry.test.ts`: mode mapping.
- `registration-strategies.test.ts`: each admission mode.
- `session-telemetry.test.ts`, `telemetry.test.ts`: header extraction.

**Database**

- `audit`, `branch`, `contacts`, `registration-code`, `waitlist`: repositories.
- `client`, `connection`, `health`: pool/probe/resilience.
- `isolation`, `schema-defense`, `schema`: constraints and schema behavior.
- `like`: wildcard escaping.
- `rls`, `rls-setup`, `rls-enforcement`: RLS policies, bootstrap, boot checks.
- `tenant-context`: GUC and missing-tenant failures.

**API**

- `api`: baseline routes/envelopes.
- `auth-http`: Better Auth mounted correctly.
- `auth-registration`: project registration.
- `auth-registration-concurrency`: invite/code race behavior.
- `contacts`, `crud-surface`: REST CRUD.
- `graphql`: queries, mutations, safety, errors.
- `health-checks`: liveness/readiness.
- `idempotency`: replay/conflict/concurrency.
- `membership-cache`: TTL/invalidation.
- `middleware-pipeline`: headers, CORS, rate limits, body limits, logs.
- `openapi`, `route-schemas`: contract generation and schemas.
- `service-layer`: service rules.
- `shutdown`: drain/exit behavior.
- `tenant-access`, `tenant-isolation`: cross-tenant denial.

### 18.5 CI

Main job:

1. install with frozen lockfile,
2. Biome lint,
3. typecheck all workspaces,
4. OpenAPI drift check,
5. GraphQL drift check,
6. Drizzle migrations,
7. full test suite with `RLS_ENABLED=false`.

RLS job:

1. migrations,
2. `db:rls:test` bootstrap,
3. only the RLS suites, with `RLS_ENABLED=true` and both DB URLs set equal.

CD job (tags `v*`):

1. lint + typecheck,
2. build,
3. Docker Buildx image to GHCR,
4. GitHub release.

### 18.6 Test gaps

- No coverage threshold or coverage reporting.
- No load/performance tests.
- No browser E2E tests.
- No contract tests against real consumers.
- No mutation testing.
- No test for multi-instance cache/rate-limit behavior.
- No automated test for production Docker startup (`start` script missing).
- The main CI job sets `DATABASE_URL` but not `DATABASE_URL_TEST`; any database
  suite that calls the strict guard would fail unless the test environment
  provides both. This is a CI configuration risk to verify.
- RLS proof covers the three protected tables only; it does not prove every
  future/business table is covered.

---

## Related

- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
- [Operations](operations.md)
