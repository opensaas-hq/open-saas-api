# Development Guide

> Part of the [Open SaaS API documentation](README.md). Section numbers are kept from the original architecture guide for traceability. For technical debt see [Technical Debt](technical-debt.md).

## 21. Extension Playbooks

These are the concrete change paths for the most common evolution tasks. They
describe what the current architecture expects; follow the existing conventions
rather than introducing parallel mechanisms.

### 21.1 Add a configuration variable

1. Add the field to `envSchema` in `packages/core/src/config.ts`.
2. Use `booleanFlag` for booleans so `"false"` does not become truthy.
3. Add it to `.env.example` with units, defaults, and security notes.
4. Add/extend `packages/core/src/__tests__/config.test.ts`.
5. Read it through `getEnv()` or an injected `env`; do not read
   `process.env` in feature code.
6. Update the tests' base env in `apps/api/src/__tests__/support/app.ts` if the
   app needs a deterministic test value.
7. Update deployment manifests (Compose, CI, production config) only if the
   variable is required there.
8. Document the operational impact in this file if it changes behavior.

### 21.2 Add a tenant-scoped table

1. Add the Drizzle table to `packages/database/src/schema.ts`.
2. Include `organization_id` with FK to `organization.id`.
3. Add indexes for the real query patterns, starting with
   `(organization_id, ...)`.
4. Prefer composite FKs that include the tenant when referencing another tenant
   table; do not repeat the current `contacts.branch_id` gap.
5. Run `bun --filter @opensaas/database db:generate` and review the SQL.
6. Run `db:migrate` against development and test databases.
7. If the table is tenant data:
   - add it to `RLS_PROTECTED_TABLES` in
     `packages/database/src/client/rls.ts`;
   - add enable/force/policy/grants to `sql/rls-setup.sql`;
   - add teardown to `sql/rls-teardown.sql`;
   - extend the RLS tests.
8. Add a repository under `packages/database/src/repositories/` that requires
   `organizationId` and uses `runInTenantContext`.
9. Add a service under `apps/api/src/services/`; keep rules there, not in the
   route.
10. Add DTOs and Zod schemas under `apps/api/src/dto/`.
11. Expose the domain through REST and/or GraphQL, then regenerate snapshots.
12. Add tests for repository isolation, service rules, HTTP behavior, and RLS.

### 21.3 Add a REST endpoint

1. Define request/response Zod schemas in the appropriate `dto` module.
2. Add a service method (or extend an existing one) with explicit
   `organizationId` and `actorId` inputs.
3. Declare the route with `createRoute`; include request schemas and documented
   success/error responses.
4. Mount `tenantContextMiddleware` on the router.
5. Add `requirePermission(...)` unless membership alone is the intended rule.
6. Use `validationHook` for the request validation error shape.
7. Return `ok(...)` / `fail(...)` envelopes.
8. Mount the route under `/api/v1`.
9. Decide whether a legacy alias is warranted; if yes, mount the same router
   on the unprefixed path so deprecation headers apply.
10. Run `openapi:generate` and commit `apps/api/openapi.json`.
11. Add route/contract tests in `apps/api/src/__tests__/`.
12. Add the endpoint to §7.1 of this document.

### 21.4 Add a permission or role

1. Add the permission key to `PERMISSION_MATRIX`.
2. Decide the allowed roles explicitly; never default to “all”.
3. Use `requirePermission` in REST and `authorize` in GraphQL.
4. Add tests for every role, including unknown role denial.
5. Update the matrix table in §10.3.

If a new role is introduced:

1. Add it to `ROLES` in `membership.service.ts`.
2. Add it to the permission matrix.
3. Verify Better Auth writes the same string.
4. Add tests for cache behavior, authorization, and migration of existing rows.
5. Consider how `owner` semantics (last-owner protection) are affected.

### 21.5 Add a GraphQL field or mutation

1. Add the type/input/field to the SDL in `graphql/schema.ts`.
2. Add a resolver in `graphql/resolvers.ts`.
3. Delegate to a service; do not query the DB or duplicate business rules.
4. Reuse the REST Zod schema for validation where possible.
5. Add `authorize(...)` for mutations.
6. Map domain values to GraphQL vocabulary in `presenters.ts`.
7. Wrap the resolver body in `run(...)`.
8. Run `graphql:generate` and commit `graphql.schema.graphql`.
9. Add tests for success, validation, authorization, and error mapping.
10. Update §14.2.

### 21.6 Add a registration mode

1. Add the mode to `REGISTRATION_MODES` in `packages/core/src/config.ts`.
2. Add it to the auth package's `StrategyMap`.
3. Implement a strategy under `registration/strategies/`.
4. Wire it in `createStrategyRegistry` so the exhaustive type still compiles.
5. Add validation semantics and any transactional side effect.
6. Add strategy and flow tests.
7. Update `.env.example` and §9.
8. Consider idempotency and audit implications.

### 21.7 Integrate a real email or payment provider

**Email**

1. Implement `EmailSender` from `packages/auth/src/ports/email.ts`.
2. Inject it into `createAuth` through `CreateAuthOptions.emailSender`.
3. Keep tokens out of logs; the port receives URLs, not raw passwords.
4. Add failure/retry behavior in the adapter, not in the auth package.
5. Add tests with a capturing sender.

**Payment**

1. Implement `PaymentVerificationPort`.
2. Make the adapter verify the provider event server-side.
3. Return only a verified/denied result; do not trust client claims.
4. Inject it into the strategy registry at the API composition root.
5. Decide how failures and replays map to registration errors.
6. Add tests for verified, denied, duplicate, and provider-error paths.

### 21.8 Record a new audit event

1. Decide the action name (`entity.verb`).
2. Build an `AuditEvent` with actor, tenant, entity, timestamp.
3. Use `computeAuditDiff` for entity mutations.
4. Pass it to the injected `AuditPort`.
5. If the mutation is transactional, write the audit event inside the same
   transaction.
6. Add tests asserting the event and its redaction.
7. Remember that PII in `changes`/`metadata` is only key-redacted; avoid putting
   secrets or unnecessary personal data there.

### 21.9 Change the schema or RLS policy safely

1. Generate a migration; never edit an applied migration.
2. Apply it to development.
3. Apply it to the test database before running tests.
4. If RLS is enabled, update policies/grants in the same deploy window.
5. Verify with `assertRlsEnforcement` and the RLS suite.
6. Roll out in an order compatible with old and new application versions:
   expand schema → deploy code → contract later.
7. Back up before destructive changes.

### 21.10 Add a workspace package

1. Create `packages/<name>/package.json` with `"type": "module"` and a
   `typecheck` script.
2. Export TypeScript source through `main`/`module`, or provide a real build.
3. Declare dependencies explicitly; do not rely on the root installation.
4. Add the package to any Docker build/copy logic if the runtime needs it.
5. Keep dependency direction acyclic:
   `core` is a leaf; `database` and `auth` depend on core; `api` depends on all.
6. Add tests and include the package in CI typecheck/test.

---

## 22. Architectural Invariants and Coding Rules

These rules describe how the current system stays coherent. Breaking one is an
architectural change, not a refactor.

### 22.1 Tenancy

- The tenant id comes **only** from `session.activeOrganizationId`.
- No request body, query parameter, or GraphQL argument may select a tenant.
- Every tenant-owned query includes `organization_id` in the `WHERE`.
- Tenant repository calls run inside `runInTenantContext`/`withTransaction`.
- Cross-tenant resources are reported as 404.
- A missing active organization is a 400; non-membership is a 403.
- Branch references are validated against the tenant before use.
- A new tenant table must be added to RLS or explicitly documented as
  unprotected.

### 22.2 Layering

- `core`: contracts, config, errors, response envelopes, logging, audit
  helpers. No database, no HTTP framework.
- `database`: schema, repositories, transactions, RLS, resilience. May import
  `core` for shared contracts.
- `auth`: Better Auth configuration, registration strategies, ports. May import
  `core` and `database`.
- `api`: transport, middleware, services, GraphQL/OpenAPI. May import all
  packages.
- Empty feature packages must not be presented as implemented.
- Routes/resolvers do not call repositories directly.
- Repositories do not know about HTTP, GraphQL, or response envelopes.
- Services do not know about Hono or GraphQL Yoga.

### 22.3 HTTP contract

- Every product route lives under `/api/v1`.
- Success uses `{ success: true, data, pagination? }`.
- Failure uses `{ success: false, error: { code, message, details? } }`.
- Validation failures are 422 with `fieldErrors` in details.
- Unknown errors are masked as `INTERNAL_SERVER_ERROR`.
- 429 includes `Retry-After`.
- Legacy paths keep working with `Deprecation`, `Sunset`, and `Link` headers.
- Route declarations and runtime validation share the same Zod schemas.
- OpenAPI is generated, never hand-maintained.
- A route change requires regenerating and committing the snapshot.

### 22.4 Data integrity

- Migrations are generated through Drizzle and committed.
- Applied migrations are never edited.
- Tenant FKs should be composite where cross-tenant references are possible.
- Audit events should be written in the same transaction as the mutation when
  atomicity matters.
- Idempotency keys are scoped by logical owner + endpoint + key.
- Unique constraints belong in the database when the invariant is absolute.
- Do not enforce security invariants only in the client or in documentation.

### 22.5 Configuration and secrets

- All configuration is validated by `envSchema` before use.
- Feature code uses `getEnv()` or injected `env`, not `process.env`.
- New variables are documented in `.env.example`.
- Secrets never appear in logs, audit payloads, or snapshots.
- `BETTER_AUTH_SECRET` must be strong and environment-specific.
- Production must override development defaults from Compose.

### 22.6 Testing

- Database-writing tests must use the test database and its guard.
- Tests truncate between cases; they must not depend on order.
- New behavior needs a test at the lowest layer that owns it, plus an HTTP or
  resolver test when the transport contract matters.
- Contract changes require snapshot regeneration and tests.
- RLS changes require the RLS proof suite.
- Cross-tenant denial must be tested for every new tenant resource.
- Do not weaken the test-database guard to make a suite pass.

### 22.7 Performance and resilience

- List endpoints paginate and cap `limit`.
- Queries use tenant-leading indexes for common filters.
- Metadata and bulk payloads are bounded at the edge.
- GraphQL documents are bounded by depth/cost.
- Do not add unbounded in-memory maps without eviction.
- Long-running work should not be added to a request path without a timeout,
  retry policy, and observability story.

### 22.8 Operations

- `/healthz` is liveness; `/readyz` is readiness.
- Do not put dependency checks in liveness.
- Shutdown must drain before closing the pool.
- Boot should fail on invalid config, unreachable DB, or failed RLS proof when
  RLS is enabled.
- Migrations and RLS bootstrap are deploy steps, not implicit app behavior.

### 22.9 Intentional behavior and error semantics

These are not bugs; callers and tests must preserve them:

- A cross-tenant id returns 404, not 403.
- Missing active organization returns 400; non-membership returns 403.
- Branch deletion nulls contact branch references.
- Contact and branch deletion are hard deletes.
- Registration does not create a session.
- GraphQL errors use HTTP 200 with `errors`.
- Audit `entity_id` is text even for UUID entities.
- Rate limits apply to all writes, including auth writes.
- `RLS_ENABLED=false` is the default.
- Membership roles are cached for 30 seconds by default.

---

## Related

- [Overview](architecture/overview.md)
- [Multi-tenancy](architecture/multi-tenancy.md)
- [API](architecture/api.md)
- [Testing](architecture/testing.md)
- [Technical Debt](technical-debt.md)
- [Roadmap](roadmap.md)