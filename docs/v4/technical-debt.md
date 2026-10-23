# Technical Debt Register

Residual issues found while executing the [roadmap](./roadmap.md), captured so they are resolved as soon as the item that owns them lands. Entries are grouped by the item that **resolves** them; `Origin` points at where the issue was detected. No changes are made to `docs/v1`, `docs/v2` or `docs/v3`.

---

## §2.1 — Uniform repository layer

- [x] **TD-17 — Repository migration is a facade; the service layer is still missing.** The two coexisting conventions are unified (`contacts.ts` → `repositories/contact.ts`, `repositories/branch.ts` added, every function takes a required `organizationId` and an optional `tx`), and `createContactsBulk` now runs inside `withTransaction`. §4.4 closed the remaining half: `apps/api/src/services/` now owns the transaction and the audit emission (`contacts.service.ts` runs the bulk import in one `withTransaction` and writes the audit rows inside it), the routes are pure adapters (no repository import, no business branching) and a DTO layer (`apps/api/src/dto/`) maps the rows with explicit mappers.
  **Origin:** §2.1. **Refs:** roadmap §2.1, §4.4.

- [x] **TD-33 — Root-level modules beyond client/schema/index.** §2.1 AC1 expects `packages/database/src/*.ts` to reduce to `client.ts`, `schema.ts`, `index.ts` (plus colocated tests). `schema.test.ts` was relocated under `__tests__/` (the §5.4 convention), `resilience.ts` moved under `client/`, and §4.6 moved the last two loose root modules there too: the probe (`client/health.ts`) and the new enforcement check (`client/rls.ts`). The root now holds only `client.ts`, `schema.ts` and `index.ts`.
  **Origin:** §2.1. **Refs:** roadmap §2.1 AC1, §2.5, §2.8, §5.4; TD-24.
  **Resolved:** §4.6/§4.8 — `packages/database/src/` root reduced to `client.ts`, `schema.ts`, `index.ts`.

## §2.2 — Schema defense in depth (constraints, indexes, audit table)

- [ ] **TD-18 — `@opensaas/database` is no longer a strict leaf (approved deviation).** §2.2 requires `repositories/audit.ts` to implement `AuditPort`, whose types and `toAuditRecord` live in `@opensaas/core`. Importing them makes `database` depend on a workspace package, which contradicts docs/v3 §5.2 rules 3–4 ("`database` and `core` are leaves"; "if you need `core` from `database`, move the shared type"). Decision taken while executing §2.2: let `database` import `core` (the port is the one audit contract), accepting the deviation; docs/v3 is not edited. Revisit if the audit port moves to a neutral shared package.
  **Origin:** §2.2. **Refs:** roadmap §2.2, §1.6; docs/v3 §5.2 (rule 3, rule 4), §5.3.

- [ ] **TD-19 — `updatedAt` is maintained by the ORM, not by the database.** `$onUpdate(() => new Date())` sets `updated_at` from Drizzle on `.update()`; raw SQL writes and other clients bypass it, so the value is not guaranteed by the schema. Drizzle cannot declare triggers, so a database-level guarantee (a `set_updated_at()` function + `BEFORE UPDATE` triggers) needs an applied script, which reintroduces exactly the standalone-SQL/migration workflow the project is deliberately avoiding while there is no released schema. Resolution is therefore deferred until a real migration workflow exists (§5.1/§5.5): either the trigger becomes part of a committed migration, or the schema is considered authoritative via `db:push` in development only, and the guarantee is revisited when deployment lands.
  **Origin:** §2.2. **Refs:** roadmap §2.2, §2.3, §5.1, §5.5.

## §2.3 — Committed migrations

- [ ] **TD-20 — Dev database reconciled by hand; future drift must come from migrations.** `packages/database/drizzle/0000_*.sql` is the first committed migration and builds the schema from scratch (verified on a fresh `opensaas_test`). The pre-existing dev database had been provisioned by `db:push`, so `CREATE TABLE IF NOT EXISTS` skipped its tables and `contacts.status` / `organization.metadata` were reconciled with manual `ALTER`s to match the migration. From here every schema change must go through `db:generate` → commit; a reconciliation script or a documented reset path for legacy databases is still missing. Also awaiting §5.1: CI switching from push to migrate, and `.env.example` documenting the `DATABASE_URL_TEST` requirement.
  **Origin:** §2.3. **Refs:** roadmap §2.3, §5.1, §2.7.

- [ ] **TD-34 — `db:push` is not yet documented as local-dev-only (§2.3 AC4).** The generate → review → `db:migrate` path works and `db:push` remains in the scripts, but the "`db:push` is local-dev-only, never for production/provisioning" rule is not written anywhere. `package.json` cannot carry comments and the root README/CONTRIBUTING are §5.5's to write, so this AC is deferred to that documentation pass.
  **Origin:** §2.3 AC4. **Refs:** roadmap §2.3 AC4, §5.5.

## §2.5 — Connection resilience (startup wait, retry/backoff, circuit breaker)

- [ ] **TD-25 — Resilience helpers are not wired into app boot or routes.** §2.5 ships `waitForDatabase()` (retrying startup probe) and `executeResilient()` (retry + breaker). §4.8 wired the boot: the process now `await waitForDatabase()` before it starts serving, and the RLS enforcement check of the boot goes through `executeResilient` (idempotent read). What remains is the service layer: the tenant-scoped queries must route through `executeResilient` so transient failures are absorbed and an open breaker surfaces as a 503 — that uniform wrapper is TD-28, not a call-site problem.
  **Origin:** §2.5. **Refs:** roadmap §2.5, §4.4, §4.8; TD-28.

- [ ] **TD-26 — Circuit breaker is process-global, not injected.** `getBreaker()` memoizes a single breaker from `getEnv()`, and `executeResilient` reaches for it unless a `breaker` is passed. Until the §4.7 DI slots exist (TD-06, TD-23) the breaker, like `db`, is a module global reseatable only by the test seam `resetBreaker()`.
  **Origin:** §2.5. **Refs:** roadmap §2.5, §4.7; TD-06, TD-23.

- [ ] **TD-27 — Breaker counters are not published as metrics.** `CircuitBreaker` exposes `trips`/`rejected` and an `onStateChange` hook, but boot never subscribes, so an opening breaker is invisible to operators. §5.6 (observability) must export state changes and counters.
  **Origin:** §2.5. **Refs:** roadmap §2.5, §5.6.

- [ ] **TD-28 — Retry/breaker protection is opt-in per call.** Repositories import the `db` proxy directly, so `executeResilient` is only used where a caller chooses it; there is no default wrapper guaranteeing every DB call inherits the policy. §4.4 prepared the ground: every repository function used by the API now accepts the handle it runs on (`db?` option), so a repository base/factory that applies the policy uniformly can be introduced without changing the call sites. The wrapper itself is still missing.
  **Origin:** §2.5. **Refs:** roadmap §2.5, §4.4; TD-23.

## §2.6 — Safe query construction

- [ ] **TD-29 — LIKE escaping is applied in one repository only.** §2.6 added `escapeLikePattern`/`toContainsLikePattern` and applied them to the contact search (`ESCAPE '\\'`), but the guarantee is per-call-site: any future `ILIKE`/`LIKE` must remember the helper and the `ESCAPE` clause. A typed query builder or lint rule would enforce it structurally. §4.4 narrowed the surface: the contact search is now the only `ILIKE` call site, and it sits behind `contacts.service.ts` instead of a route.
  **Origin:** §2.6. **Refs:** roadmap §2.6, §4.4.

- [ ] **TD-35 — "Raw input never reaches a LIKE pattern unescaped" not documented.** §2.6 ships the helper with JSDoc, but the repository-playbook convention (a note in docs/v3/architecture.md §14.2) is a §5.5 deliverable and does not exist yet. Write it during the documentation pass.
  **Origin:** §2.6. **Refs:** roadmap §2.6, §5.5.

## §2.7 — Database test isolation

- [ ] **TD-30 — Isolation relies on global config/db resets (TD-11).** The guard calls `resetConfig()` + `resetDb()` before each suite so the lazily-built client uses the real process environment instead of a synthetic config left behind by `config.test.ts`. This works around TD-11; the durable fix is dependency injection (§4.7) so no global overrides exist between suites. §4.0 gave the HTTP app its own factory: the `apps/api` suites build the app with an injected configuration and never touch `process.env`. The `packages/database` suites still need the resets, because their repositories use the global handle (TD-23).
  **Origin:** §2.7. **Refs:** roadmap §2.7, §4.7; TD-11.

- [ ] **TD-31 — Project-wide `test:unit`/`test:integration` split and hook policy are §5.4.** §2.7 only owns the `packages/database` machinery (guard, truncation, `test:unit`/`test:integration`). The root scripts, the `pre-commit` hook that currently runs the full suite, and the "must pass with the database stopped" guarantee for every package are §5.4's to finish.
  **Origin:** §2.7. **Refs:** roadmap §2.7, §5.4.

- [ ] **TD-32 — `.env.test` is gitignored and unprovisioned for CI.** Integration tests require `DATABASE_URL_TEST` (equal to `DATABASE_URL`) in `.env.test`, which is not committed, so a fresh clone or CI job has no test database. §5.1 (CI) and §5.4 must provision the test database and document the requirement (`.env.example` already lists `DATABASE_URL_TEST`).
  **Origin:** §2.7. **Refs:** roadmap §2.7, §5.1, §5.4.

## §2.4 — Client factory and connection discipline

- [x] **TD-21 — `close()` is not wired into graceful shutdown.** §2.4 exported `close()` and the lazy `db` proxy, but nothing called `close()` on process shutdown, so the pool was never drained in a real boot.
  **Origin:** §2.4. **Refs:** roadmap §2.4, §4.8.
  **Resolved:** §4.8 — the shutdown controller (`apps/api/src/shutdown.ts`) closes the pool through `close()` after the drain, then flushes the logs and exits; `SIGTERM`/`SIGINT` are handled idempotently.

- [ ] **TD-22 — The readiness probe leaves a dangling query after a timeout.** The probe (`probeDatabase`, `packages/database/src/client/health.ts`) races the query against a timer but cannot cancel the in-flight query, so a timed-out handle keeps a query running until the pool reclaims it. Acceptable for the 2 s probe budget (`HEALTH_PROBE_TIMEOUT_MS`); revisit if the pool grows or the probe is called more often.
  **Origin:** §2.8. **Refs:** roadmap §2.8, §4.6.

- [ ] **TD-23 — Lazy `db` proxy is not injectable end-to-end.** §4.0 wired the `AppVariables.db` slot and the app factory injects the handle, but the repositories still import the process-global `db` proxy directly, so the injected handle never reaches the data layer. §4.4 closed the gap for the API surface: `withTransaction`/`runInTenantContext` and the repositories they serve accept an optional handle, the services receive it from the app factory and the registration flow forwards it to the auth package, so the app's handle now reaches the data layer instead of the module proxy. What remains is the full factory/base (with the breaker, TD-26) so no call site can fall back to the global by accident, and the Better Auth handle in `packages/auth`.
  **Origin:** §2.4. **Refs:** roadmap §2.4, §4.7, §1.2; TD-06.

## §2.8 — Remove the health mock from the data layer

- [x] **TD-24 — Health probe lives in the data layer, not the app.** §2.8 removed the `NODE_ENV === "test"` mock and made the probe honest, keeping `health.ts`. The roadmap allowed either deleting it or reducing it to an injected probe.
  **Origin:** §2.8. **Refs:** roadmap §2.8, §4.6.
  **Resolved:** §4.6 — decision: the **endpoint** lives in the app (`apps/api/src/routes/health.ts`: `/healthz`, `/readyz` and the deprecated `/api/health` alias) and depends on a port (`DatabaseProbe`); the **probe** stays in the data layer (`packages/database/src/client/health.ts`) because it is the only place that knows the SQL driver, and it became env-free (`probeDatabase({ db, timeoutMs })` — the timeout is always injected, there is no environment branching and no mock). The composition root (`app.ts`) is the only place that wires the two together.

## §2.5 (Phase 2.5) — Postgres Row-Level Security

- [ ] **TD-36 — No committed enabling/rollback migration for RLS (§2.5.1 AC4).** There is no released schema yet, so nothing is deployed to migrate; the RLS bootstrap ships as an idempotent script (`packages/database/sql/rls-setup.sql` + `rls-teardown.sql`, applied via `db:rls:test`) rather than a committed Drizzle migration with a matching rollback. When a deployment target and migration workflow exist (§5.1/§5.5), convert the bootstrap into an enabling migration applied conditionally on `RLS_ENABLED`, with a committed disable/rollback migration.
  **Origin:** §2.5.1 AC4. **Refs:** roadmap §2.5.1 AC4, §5.1, §5.5.

- [ ] **TD-37 — Rollout runbook for enabling/disabling RLS (§2.5.4 AC1).** §2.5.4 asks for a runbook with enable, verify (`SELECT rowsecurity FROM pg_class …`) and rollback steps, executable as written (dry-run on staging), plus a "who is affected" note for long-lived pooled connections. There is no staging target yet, so the runbook is deferred to the deployment phase; `docs/architecture/multitenancy.md` documents the mechanics it would reference.
  **Origin:** §2.5.4 AC1. **Refs:** roadmap §2.5.4 AC1, §5.1, §5.5.

- [ ] **TD-38 — `RLS_ENABLED` must default on once §4.4 adoption is complete (§2.5.4).** The flag defaults to `false` in local development until every tenant-scoped call path runs inside a tenant transaction (§4.4 application-layer adoption). After Phase 4 the default should flip to `true`. §4.4 landed the service layer (every tenant-scoped call goes through `withTransaction`/`runInTenantContext`) and §4.6/§4.8 landed the machinery the flip needs: the boot check that fails the process when the tenancy boundary is not enforced (`assertRlsEnforcement`: effective role is neither a superuser nor `BYPASSRLS`, the three business tables enable **and** force row-level security, the tenant GUC round-trips in a transaction), the `ALTER DEFAULT PRIVILEGES` fix of the bootstrap (a table created later inherits the grants of the runtime role) and the `db:rls:dev` script that bootstraps a development database. What remains is the **flip itself** (`RLS_ENABLED` default → `true`) plus the environment it implies: the development database must be bootstrapped (`bun run --filter @opensaas/database db:rls:dev`) and the runtime connection must assume the `opensaas_app` role, so the flip is scheduled for the end of Phase 4 together with the decision on the development `DATABASE_URL`.
  **Origin:** §2.5.4. **Refs:** roadmap §2.5.4, §4.4, §4.6, §4.8.

## §3.6 — Email anti-abuse policy (config-driven)

- [x] **TD-03 — Raw `DISPOSABLE_EMAIL_DOMAINS` read + test mutation.** `packages/auth/src/email-policy.ts` reads `process.env.DISPOSABLE_EMAIL_DOMAINS` on every call and `packages/auth/src/__tests__/email-policy.test.ts` mutates it between cases. Both are cleaned up when the policy becomes config-driven and receives injected config.
  **Origin:** §1.1 (raw-read inventory), §1.2 work bullet 4. **Refs:** roadmap §1.1, §1.2 bullet 4, §3.6.
  **Resolved:** §3.6 — `getDisposableDomains()` reads the **validated** config (`getEnv().DISPOSABLE_EMAIL_DOMAINS`, with an injectable override for tests); the test uses `initConfig`/`resetConfig`, not `process.env` mutation. `grep -rn "process.env" packages/auth --include="*.ts"` is clean outside tests.

## §4.2 — Registration route (thin route + service)

- [ ] **TD-08 — Finish adopting the §1.3 envelope builders in `apps/api`.** §1.3 shipped `ok` / `fail` / `fromZodError` / `statusFromError`; most adoption has now landed early — `app.onError` and `/api/health` use the builders, `app.notFound()` returns the JSON envelope, the register success/failure paths and all contacts responses use `ok`/`fail`, the local `catch` no longer defaults to 400 (it maps through `statusFromError`), and `contactsQuerySchema` uses `safeParse`. §4.4 moved the register/contacts bodies into services, so the routes are pure adapters again: they validate with `zValidator` + the shared hook (`dto/validation.ts`) and serialize with `ok`/`fail`, and the error path is the single `app.onError` serializer. What remains: the fault-injection test proving a DB-down returns 500 (not 400) end to end.
  **Origin:** §1.3. **Refs:** roadmap §1.3, §4.2.

## §4.5 — Cross-cutting middleware pipeline

- [x] **TD-10 — Wire the request context + access log.** §4.5 closed it: the `request-id` middleware opens the §1.4 context per request (the id is echoed in the `x-request-id` response header, a client id is honoured only when it is short and made of safe characters), the tenant middleware enriches it with the tenant and the user, and the access log emits exactly one structured line per request (method, path, route, status, duration, request id, tenant id, user id — never a body nor a query string). The pipeline also brought the security headers, the CORS allowlist, the write rate limiter and the global body-size limit.
  **Origin:** §1.4. **Refs:** roadmap §1.4 work bullet 2, §4.5, §5.6.

## §4.7 — Context types and DI slots

- [ ] **TD-11 — Config/logger overrides are globals, not real DI.** §1.4 closes the fake-logger seam with module-level `setLogger` / `resetLogger`, and the §1.1–§1.5 pass added the analogous `resetConfig` for the memoized `env`. §4.0 wired the DI slots for real: `AppVariables` now carries the validated `env`, the `db` handle, the `AuthInstance` and the `Logger`, all injected by the app factory, and the context types for `user` / `session` are inferred from the Better Auth instance instead of hand-written copies. §4.5 moved the access log and the error handling onto the injected logger and retired the global reads: the request path (pipeline, routes, error handler) only uses `c.get("logger")`, and the boot builds its logger with `createLogger(env)` instead of the memoized global. What remains: the module-level `setLogger` / `resetLogger` seam of `@opensaas/core` still exists as a test helper, and `getEnv()` is still the boot-time accessor of the memoized configuration.
  **Origin:** §1.4 (TD-01 resolution), §1.5. **Refs:** roadmap §1.4, §1.2, §4.7, §4.5.


## §5.3 — Dependencies, monorepo and configuration hygiene

- [ ] **TD-14 — Finish the dependency-declaration sweep.** §1.5 declared `zod` in `packages/core` (and removed the hoisting-only root entry); `apps/api` got its `zod` + `@hono/zod-validator` declarations too, so the §5.3 work bullet "declare `zod` in `apps/api`" is already done. A full audit of every workspace's external imports against its `package.json` found no other undeclared import (`packages/database` → `drizzle-orm`/`postgres`; `packages/auth` → `better-auth`; core → `pino`/`zod`), and `packages/database` installs in isolation. Remaining here is the rest of §5.3: `tsconfig`/project references/`exports` maps, the `drizzle-orm` ↔ Better Auth peer skew (0.36 vs ^0.45.2), and `bun-types` removal.
  **Origin:** §1.5 (root `zod` removal). **Refs:** roadmap §1.5, §5.3.

## §4.9 — Full CRUD surface, idempotency and conditional requests

- [ ] **TD-39 — The idempotency table is not covered by row-level security.** §4.9 added `idempotency_keys` to the schema and its repository, but the RLS bootstrap (`packages/database/sql/rls-setup.sql`) only protects the three business tables (`contacts`, `branches`, `audit_log`). The table is internal — no route returns it — and its rows are separated logically (scope + endpoint + key), but a compromised application role could read the stored responses of another scope. A policy keyed on the scope column (or the decision to keep the table outside RLS) has to be taken when the runtime role assumes `opensaas_app` (TD-38).
  **Origin:** §4.9. **Refs:** roadmap §4.9, §2.5.4; TD-38, TD-36.

- [ ] **TD-40 — The API surface table of `docs/v3` §19.2 does not list the new verbs.** §4.9 closed the schema↔API gap for the branches (they had tables and services but no route) and added `GET`/`PATCH`/`DELETE /api/contacts/:id`, `GET`/`POST`/`PATCH`/`DELETE /api/branches`, the `Idempotency-Key` header and the `ETag`/`If-None-Match` behaviour. The surface itself is documented in the JSDoc of the routes and the services, because `docs/v3` is not edited during the roadmap execution; the table has to be refreshed in the documentation pass (§5.5). §4.10 added the versioned prefixes (`/api/v1/*`) and the alias/sunset policy to the root README, so what remains is aligning `docs/v3` §19.2.
  **Origin:** §4.9. **Refs:** roadmap §4.9, §4.10, §5.5; docs/v3 §19.2.

- [ ] **TD-41 — `db:push` fails on the already-provisioned databases.** The development and test databases were created by a `drizzle-kit` version that named the `NOT NULL` constraints (`<table>_<column>_not_null`); the installed `drizzle-kit@0.28` does not recognise them and tries to drop them, which PostgreSQL refuses for the columns that belong to a primary key (`42P16`). The push still creates the new tables before it fails, so the schema is in sync, but the command always ends with an error and the drift is invisible. Fixing it means either reconciling the databases by hand (dropping the named constraints) or pinning the `drizzle-kit` version that created them.
  **Origin:** §4.9 (the `idempotency_keys` table could not be pushed cleanly). **Refs:** roadmap §2.3, §5.1, §5.5; TD-20, TD-34.

## §4.10 — OpenAPI 3.1 contract, versioned surface and legacy aliases

- [ ] **TD-42 — The health probes are deliberately outside the OpenAPI document.** `buildOpenApiDocument` only reflects the versioned registry, so `/healthz` and `/readyz` (and the deprecated `/api/health`) are absent from `/api/v1/openapi.json`. They are operational endpoints, not part of the product contract the SDKs are generated from. If a deployment pipeline wants to discover them from the contract, they need their own (unversioned) document or a `tags: ["Health"]` extension.
  **Origin:** §4.10. **Refs:** roadmap §4.10, §4.6.

- [ ] **TD-43 — The Swagger UI page depends on a CDN and relaxes the CSP for that route only.** `/api/v1/docs` serves a self-contained HTML page that loads `swagger-ui-dist@5.17.14` from `cdn.jsdelivr.net`; the strict headers middleware is overridden there with `swaggerUiContentSecurityPolicy`. A deployment without egress to the CDN (or an air-gapped install) gets a blank page. Vendoring the bundle as a build asset would remove both the external dependency and the CSP exception.
  **Origin:** §4.10. **Refs:** roadmap §4.10, §4.5.

- [ ] **TD-44 — The committed contract inlines every schema instead of using `components.schemas`.** `apps/api/openapi.json` is ~94 KB because each route carries the full serialized Zod schema and the envelope repeated per response. The schemas are not registered with `.openapi("Name")`, so no `$ref`s are emitted. The document is valid and the snapshot is small enough to review, but deduplicating the DTOs into `components.schemas` (and referencing them) would shrink it and make the diff of a single DTO change readable.
  **Origin:** §4.10. **Refs:** roadmap §4.10, §5.5.

- [ ] **TD-45 — Each legacy alias mounts a second instance of the same router factory.** The aliases must answer like their successors and carry their own interceptor, but must not enter the OpenAPI registry; the only way found to keep them out (the `OpenAPIHono` registry is merged on `route()`) was mounting the plain `Hono` returned by the router factory again under the legacy path. That registers every handler twice in memory. The cost is bounded (three routers) and the routing behaviour is identical, but a registry-aware "mount without documenting" API upstream would remove the duplication.
  **Origin:** §4.10. **Refs:** roadmap §4.10, §5.3.

## §5.4 — Enforce config injection in tests (project-wide)

- [x] **TD-07 — Convert the remaining `process.env`-mutating test.** The `apps/api` registration tests were converted to injected config early (§1.1–§1.5 work): they call `initConfig(...)` instead of mutating `process.env`, and the route reads validated `env`. What remains is `packages/auth/src/__tests__/email-policy.test.ts`, which still mutates `DISPOSABLE_EMAIL_DOMAINS`; it is closed together with TD-03 (§3.6) when the policy receives injected config.
  **Origin:** §1.2 work bullet 4. **Refs:** roadmap §1.2 bullet 4, §3.6, §5.4.
  **Resolved:** §3.6 — `email-policy.test.ts` now exercises env-provided domains through `initConfig`/`resetConfig` and the injectable domain-list parameter; no case mutates `process.env`.

- [ ] **TD-13 — Broaden per-item test coverage.** Coverage of §1.1–§1.5 was expanded early (config edge cases, structured boot failure, redaction depth/casing, `fromZodError` flattening, HTTP envelope + `notFound`), but most of the surface is still untested: `packages/auth` policy branches and `packages/database` repositories have thin coverage, and there are no HTTP tests with a real session. §5.4 owns the coverage floor, the authenticated HTTP matrix and the factories/fixtures that make maxing out per-item tests practical. Track new gaps here as items land.
  **Origin:** §1.5. **Refs:** roadmap §5.4.

## §5.5 — Open-source collaboration and documentation

- [ ] **TD-09 — Envelope contract not written in package docs.** §1.3 AC3 requires the "routes never build error envelopes by hand" rule to be written in the package docs; only JSDoc exists today. Add it to the README rewrite (quickstart already planned there) or a `packages/core` doc section.
  **Origin:** §1.3 AC3. **Refs:** roadmap §1.3 AC3, §5.5.

- [ ] **TD-15 — "Audit port + promotion rule" ADR not yet created.** §1.6 AC4 requires the promotion rule to be written in the roadmap and referenced by the ADR list in §5.5. The rule is written (roadmap §1.6, JSDoc in `packages/core/src/audit.ts`), but `docs/architecture/` and its ADRs do not exist yet — they are a §5.5 deliverable, so the ADR itself is tracked there.
  **Origin:** §1.6 AC4. **Refs:** roadmap §1.6 AC4, §5.5.

---

## Not an item — documented exception

- **`packages/database/drizzle.config.ts` raw `DATABASE_URL`.** Allowed by §1.1: `drizzle-kit` runs standalone and must not pull the full `@opensaas/core` boot just to read one variable. Preferred follow-up is running it with `--env-file` (§5.3), which keeps the read but removes the ambient-environment dependency.
  **Refs:** roadmap §1.1 (work bullet 5), §5.3.
