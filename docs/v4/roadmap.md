# Roadmap — open-saas-api (v4)

> **Date:** 2026-10-19
> **Status:** proposed
> **Supersedes:** [docs/v2/roadmap.md](../v2/roadmap.md) (P0–P3) as the active plan. When the two disagree, this file wins; v2 stays as history.
> **Companion documents:**
> - [docs/v2/analysis.md](../v2/analysis.md) — verified audit of every defect, with `file:line` evidence. **Source of truth for findings.**
> - [docs/v3/architecture.md](../v3/architecture.md) — as-is / target architecture, extension playbooks, known gaps.
> - Historical: [docs/v1/analysis.md](../v1/analysis.md) (partially corrected by docs/v2/analysis.md §10), [docs/v1/technical-overview.md](../v1/technical-overview.md).
>
> **Rule:** when a v1 claim and a v2 claim disagree, v2 wins (docs/v2/analysis.md §10).

---

## 1. How to read this document

- **Six phases**, ordered bottom-up on the package dependency graph of docs/v3/architecture.md §5.1: `core` and `database` are leaves → `auth` depends on both → `api` composes everything → cross-cutting project work closes the plan.
- Every item has: context, **references to the source documents** (`docs/…` path + section), the work to do, and **extensive acceptance criteria (AC)**. An item is done when every AC is met and independently verifiable.
- **No calendar estimates.** The order is dependency order, not dates. Priorities live inside the phases: a phase must be finished (or its blocking items finished) before the next one starts.
- **Numbering:** phases are `Phase N`, items are `§N.M`. Note that *item §2.5* (query safety, inside Phase 2) is not *Phase 2.5* (Postgres RLS). References in prose always spell the phase out as "Phase 2.5".
- **Phase exit criteria:** all ACs of the phase met; `bun run lint`, `bun run typecheck`, `bun test` green; and the sections of docs/v3/architecture.md touched by the phase updated so the "as-is" badges stay truthful (§5.5).

### Phase overview

| Phase | Scope | Depends on |
| --- | --- | --- |
| **Phase 1** | `packages/core` — config, error/response contract, logger, audit port | — |
| **Phase 2** | `packages/database` — repositories, schema defense, migrations, client discipline | Phase 1 |
| **Phase 2.5** | Postgres Row-Level Security (second line of defense) | Phase 2 |
| **Phase 3** | `packages/auth` — real registration, server-side guarantees, Better Auth hardening | Phases 1–2 |
| **Phase 4** | `apps/api` — auth surface, tenancy, services, middleware, contract, GraphQL | Phases 1–3 (2.5 before §4.4 wiring is complete) |
| **Phase 5** | Complete project — CI/CD, containers, dependencies, testing, docs, observability | items have individual prerequisites; most start in parallel |

---

## 2. Invariants — what must not regress

From docs/v2/analysis.md §9 ("what is already good"). Every phase must preserve these:

- The `AppError` hierarchy with stable SCREAMING_SNAKE error codes (`packages/core/src/errors.ts`).
- The `{ success, data | error }` response contract (docs/v3/architecture.md §9).
- Zod validation at every HTTP boundary (and, from Phase 4 on, at the GraphQL boundary).
- Tenant middleware as the single session → tenant-context resolver (docs/v3/architecture.md §10).
- Bun workspaces monorepo with a committed `bun.lock` and `--frozen-lockfile` in CI.
- Tooling: Biome, commitlint (conventional commits), husky, release-it with conventional changelog.
- The `withTransaction` helper (`packages/database/src/client.ts`) — extended, never removed.
- Email normalization + disposable-domain policy with its unit tests.
- Drizzle schema typing and the Better Auth adapter pattern (better-auth owns its seven tables — docs/v3/architecture.md §11.1).
- MIT LICENSE, issue templates, PR template.

---

## 3. Phase 1 — `packages/core` (foundation)

> Cross-cutting concerns: env validation, errors, logging, the response contract, and the audit **port** (interface only — persistence lives in `packages/database`, orchestration in `apps/api`).
> Exit gate: importing `@opensaas/core` has no side effects; every consumer reads configuration through the validated `env`; core stays a leaf package with zero internal workspace imports (docs/v3/architecture.md §5.2 rule 3).

### §1.1 One validated source of truth for configuration

**Context.** A Zod-validated `env` singleton exists, but raw `process.env` reads bypass it in five places, and `REGISTRATION_MODE` — the most security-relevant switch in the system — is not declared in `envSchema` at all and is undocumented in `.env.example`. Defaults can silently diverge; the registration endpoint is driven by unvalidated configuration.

**Refs:** docs/v1/analysis.md §2.3; docs/v2/analysis.md §3.3, §2.9, §5 (item 11); docs/v3/architecture.md §13.1, §13.2, §14.5.

**Work:**

- Add `REGISTRATION_MODE` to `envSchema` as an enum of the four modes (`public` | `waiting_list` | `invite_code` | `paid_required`) with default `public`; an invalid value fails boot with a formatted report naming the variable.
- Purge raw reads inside this package: `packages/core/src/logger.ts:3,6` (also see §1.4 — the logger must read its level *after* validation, not before).
- Harden `DATABASE_URL`: require the `postgres://` or `postgresql://` scheme (regex refinement) so typos like `postgresl://` or `http://…` fail at boot instead of at connect time with a worse message.
- Document `REGISTRATION_MODE` in `.env.example` (per docs/v3/architecture.md §14.5: new variables go in `envSchema` **and** `.env.example`).
- Track the remaining call sites, which are cleaned up in their own phases: `packages/database/src/client.ts:5` (§2.4), `packages/database/src/health.ts:6` (§2.8), `packages/auth/src/email-policy.ts:18` (§3.6), `apps/api/src/routes/auth.ts:46` (§4.2), `packages/database/drizzle.config.ts:3` (allowed exception: drizzle-kit runs standalone, but prefer `--env-file`).

**AC:**

- [ ] `grep -rn "process.env" packages/core --include="*.ts"` matches only `packages/core/src/config.ts` and test helpers.
- [ ] By the end of Phase 4, `grep -rn "process.env" apps packages --include="*.ts"` matches only `config.ts`, tests and the documented drizzle-kit exception.
- [ ] `REGISTRATION_MODE=bogus` aborts boot with a formatted report naming the variable and listing allowed values.
- [ ] `DATABASE_URL=http://localhost/x` and `DATABASE_URL=postgresl://…` both fail validation at boot.
- [ ] `.env.example` documents `REGISTRATION_MODE` with its four values and default.
- [ ] Unit tests: valid values parse, defaults apply, invalid values produce the expected error.

### §1.2 Import-time side effects → factories and injection

**Context.** Importing `@opensaas/core` runs `parseEnv()` at module load and calls `process.exit(1)` on failure; `db`, `env`, `logger` and `auth` are import-time singletons. Consequences: no fake injection in tests, impossible connection close, order-dependent tests that mutate `process.env`, and any script/migration/CLI needing the full production environment before an import even resolves. `AppVariables.env` / `AppVariables.db` (`apps/api/src/types.ts`) document a DI slot that is never assigned — dead code describing the intended design.

**Refs:** docs/v1/analysis.md §2.4, §4 (item 5); docs/v2/analysis.md §2.10, §3.4, §5 (item 6); docs/v3/architecture.md §15.3.

**Work:**

- Replace the top-level `parseEnv()` side effect with an explicit factory/lazy accessor (`createEnv()` / `getEnv()`); the *fail-fast behavior* is preserved but moved to an explicit `initConfig()` invoked by the app boot path (and by scripts that want it).
- Add `createLogger(env)` (see §1.4); keep a lazily-initialized default export for convenience, but allow tests to inject a fake.
- Assign the factory results into the Hono context via the existing `AppVariables` slots (wired in apps/api, §4.7) instead of importing singletons inside handlers.
- Convert tests that mutate `process.env` between cases to injected config (project-wide enforcement lands in §5.4).

**AC:**

- [ ] `import "@opensaas/core"` in a process without environment variables does **not** exit and does **not** throw.
- [ ] Calling the boot path (`initConfig()` / app start) still fails fast with the formatted report when config is invalid.
- [ ] A unit test runs with an injected fake env and a fake logger without touching `process.env` at all.
- [ ] `grep -rn "process.exit" packages apps --include="*.ts"` returns hits only inside the explicit init/boot function.
- [ ] No module-level connection or logger construction outside the factory paths.

### §1.3 Single response envelope helpers

**Context.** The `{ success, data | error }` envelope is assembled in three different places with three different behaviors (global `onError`, the `zValidator` callback, a local `catch` that masks 500s as 400s). Handlers hand-roll `c.json({ success: true, data })`. `ApiResponse` types exist but are never used as a builder. A raw `ZodError` from `.parse()` surfaces as 500 instead of 422. There is no `app.notFound()`, so unknown routes return Hono's plain text and break the JSON contract.

**Refs:** docs/v1/analysis.md §2.5; docs/v2/analysis.md §3.5, §2.1; docs/v3/architecture.md §9.1, §9.3, §15.3; docs/v2/roadmap.md §1.2.

**Work:**

- Add to `packages/core`: `ok(data, pagination?)` and `fail(code | error, message?, details?)` builders, plus `fromZodError(err)` → `ValidationError` (422) with field-level details.
- Export the helpers from the package barrel; keep `ApiResponse` as the response type, now actually produced by the builders.
- Document the contract: `app.onError` is the only serializer; routes/services throw typed `AppError`s or return `ok(...)` (adoption in apps/api lands in §4.2).
- Unit-test the mapping table: each `AppError` subclass → status + code; unknown error → 500 `INTERNAL_SERVER_ERROR` with **no** internal details leaked.

**AC:**

- [ ] `@opensaas/core` exports `ok`, `fail`, `fromZodError` with full unit coverage, including the unknown-error → 500 no-leak case.
- [ ] Exactly one module in core builds the envelope; core contains no other `c.json`-shaped payloads.
- [ ] The rule "routes never build error envelopes by hand" is written in the package docs and enforced by the §4.2 ACs.

### §1.4 Logger: validated, structured, correlation-aware

**Context.** The pino logger reads `NODE_ENV` and `LOG_LEVEL` from raw `process.env` *before* validation has run, so the log level is unvalidated. There is no correlation context: errors are logged without a request id, and no access logging exists at all (only errors and startup lines). There is no shared mechanism to attach tenant/user ids to every line of a request, and no redaction of sensitive fields.

**Refs:** docs/v1/analysis.md §2.3; docs/v2/analysis.md §3.3, §3.6, §4 (Correlation context missing); docs/v2/roadmap.md §1.3, §2.4.

**Work:**

- Read `LOG_LEVEL` and `NODE_ENV` from the validated `env` (after §1.1), never from raw `process.env`.
- Add an `AsyncLocalStorage`-based request context (`requestId`, `tenantId`, `userId`, route) with a `withRequestContext()` helper; the middleware wiring lands in §4.5.
- Bind context values as pino bindings so every line emitted inside the context carries them; provide a getter for consumers.
- Add redaction for `authorization`, `cookie`, `password`, `token`, `set-cookie` (field names, case-insensitive) and reuse the redaction helpers later needed by the audit diff (§1.6).

**AC:**

- [ ] Invalid `LOG_LEVEL` fails at config validation (boot), not silently at logger construction.
- [ ] A test enters `withRequestContext({ requestId: "…" })` and asserts that every log line emitted inside (including from a nested async call) carries the same `requestId`.
- [ ] A test passes objects containing `authorization` / `password` / `set-cookie` fields and asserts they never reach the serialized output.
- [ ] No raw `process.env` reads remain in `packages/core/src/logger.ts` (§1.1).

### §1.5 Declare runtime dependencies where they are used

**Context.** `zod` is imported by `packages/core/src/config.ts` but declared only in the root `devDependencies`. This works through Bun's aggressive hoisting and breaks under partial installs, production installs that prune devDependencies, or any other package manager. `@opensaas/core` ships Zod-validated configuration as a **runtime** feature while listing nothing.

**Refs:** docs/v1/analysis.md §1.7; docs/v2/analysis.md §1.7; docs/v3/architecture.md §5.1 (the `CORE ..> ZOD` gap note).

**Work:**

- Add `zod` to `packages/core` `dependencies` with a range consistent with the root (and with `apps/api`, declared in §5.3).
- Verify resolution does not rely on hoisting (isolated install of the workspace, or `bun pm ls` inspection).

**AC:**

- [ ] `packages/core/package.json` lists `zod` under `dependencies`.
- [ ] An isolated/production install of `@opensaas/core` resolves `zod` from its own dependency tree (no reliance on the root `devDependencies`).
- [ ] The lockfile records `zod` as a direct dependency of `@opensaas/core`.

### §1.6 Audit port (interface + redaction) — no new package

**Context.** There is no audit trail of who wrote what, into which tenant (docs/v1/analysis.md §2.7, docs/v2/analysis.md §3.7). docs/v2/roadmap.md §1.4 proposes an `audit_log` table written from the service layer. Design decision (this roadmap): **no dedicated `packages/audit`**, and **no audit logic in core** — core must stay a leaf with zero internal workspace imports (docs/v3/architecture.md §5.2 rule 3) and must not contain domain-specific code (§5.3). Therefore core owns only the *port* (interface) and pure helpers; `packages/database` owns the table + repository implementing the port (§2.2); `apps/api` services decide what gets audited (§4.4).

**Refs:** docs/v1/analysis.md §2.7; docs/v2/analysis.md §3.7; docs/v2/roadmap.md §1.4; docs/v3/architecture.md §5.2, §5.3, §15.1.

**Work:**

- Define `AuditEvent` (action, entityType, entityId, actor id, tenant id, changes/diff, metadata, timestamp) and an `AuditPort` interface: `record(event)` / `recordMany(events)`.
- Pure helpers: compute a before/after entity diff; redact sensitive keys from the diff (reuse §1.4 redaction rules); serialize to the storage shape.
- Provide a no-op default implementation and a recording test double so consumers can assert emitted events.
- **Promotion rule (documented here and in the ADR, §5.5):** create a real `packages/audit` workspace only when one of these appears — retention/export jobs, multiple sinks (DB + SIEM/webhook), or a query API. Until then, the port + database repository is the design.

**AC:**

- [ ] `packages/core` still has zero imports from other workspace packages (dependency rule test or documented review step per docs/v3/architecture.md §5.2).
- [ ] Unit tests cover diff computation and redaction: sensitive keys never appear in the emitted event.
- [ ] A consumer can inject a recording fake and assert emitted events without a database.
- [ ] The promotion rule ("when to create `packages/audit`") is written in this document and referenced by the ADR list in §5.5.
- [ ] `packages/audit` does not exist at the end of this phase.

---

## 4. Phase 2 — `packages/database` (persistence)

> Schema, repositories, transactions, migrations and connection discipline. Defense in depth at the data layer: constraints, indexes, audit rows — and the groundwork for Phase 2.5 (RLS).
> Exit gate: every tenant-scoped function takes `organizationId` as a required argument; migrations are committed and sufficient to build the schema from scratch; no raw `process.env`; no health mocks; no test ever touches a developer database.

### §2.1 Uniform repository layer

**Context.** Two conventions coexist in one package: `packages/database/src/contacts.ts` exports loose root-level functions, while `packages/database/src/repositories/organization.ts` follows the `repositories/` convention. The `branches` table exists in the schema but has **no repository functions and no routes** — the schema is ahead of the code. `withTransaction` exists but nothing uses it. The only tenant scoping that exists lives in the route handlers; repositories accept any `organizationId`.

**Refs:** docs/v1/analysis.md §2.2, §4 (item 3); docs/v2/analysis.md §3.2, §5 (item 3), §2.3; docs/v3/architecture.md §14.2, §15.3.

**Work:**

- Move `packages/database/src/contacts.ts` → `packages/database/src/repositories/contact.ts`; update the package barrel; root-level modules reduce to `client.ts`, `schema.ts`, `index.ts` (plus tests).
- Add `packages/database/src/repositories/branch.ts` (list/create/update/delete scoped by organization) closing the schema-ahead-of-API gap.
- One signature convention for every repository: `(options: { organizationId: string; …; tx?: Transaction })` → plain domain rows, or `{ items, pagination }` for lists. `organizationId` is **required** and always applied in the `WHERE`.
- Multi-statement flows (`createContactsBulk`, registration in §3.1) accept/require a `tx` and run inside `withTransaction`.

**AC:**

- [ ] `ls packages/database/src/*.ts` returns only `client.ts`, `schema.ts`, `index.ts` (and colocated tests, per the convention fixed in §5.4).
- [ ] Calling any repository function without `organizationId` fails `tsc` (type-level enforcement, not a runtime check).
- [ ] Branch repository functions exist with tests, including a cross-organization isolation test.
- [ ] `createContactsBulk` runs inside `withTransaction`; a mid-batch failure rolls back every row (test).

### §2.2 Schema defense in depth (constraints, indexes, audit table)

**Context.** Tenant scoping exists only as a `WHERE` clause in application code — one forgotten filter leaks another tenant's data. The schema lacks the indexes that make the tenant filter cheap, lacks unique constraints where they belong, has no CHECK/enum on a free-form `status` text, has inconsistent `metadata` types (`text` on organization, `jsonb` on contacts), and `updatedAt` is never maintained because Drizzle's `$onUpdateFn` is not configured. There is no audit log.

**Refs:** docs/v1/analysis.md §2.7; docs/v2/analysis.md §2.5, §3.7; docs/v2/roadmap.md §1.4; docs/v3/architecture.md §11.2.

**Work:**

- Indexes: `contacts(organizationId, status)`, `contacts(organizationId, branchId)`, `member(organizationId, userId)`.
- Unique partial index: contact email per organization (where email is not null).
- Configure `$onUpdateFn` so `updatedAt` is maintained on every table that declares it.
- Convert `contacts.status` to a `pgEnum` (or CHECK) covering `active | lead | churned`.
- Migrate `organization.metadata` from `text` to `jsonb` for consistency with `contacts.metadata`.
- Add the `audit_log` table (actor id, tenant id, action, entity type/id, `jsonb` diff, timestamp) plus `packages/database/src/repositories/audit.ts` **implementing `AuditPort`** from §1.6.
- All changes ship as committed migrations (§2.3).

**AC:**

- [ ] `EXPLAIN` on the tenant-filtered list query (`WHERE organization_id = $1 [AND status = …]`) uses one of the new indexes (documented plan check or automated regression test).
- [ ] `updatedAt` changes on update without application code setting it (integration test).
- [ ] A duplicate contact email within the same organization is rejected by the database, not by application code.
- [ ] An invalid `status` value is rejected at the database level.
- [ ] Inserting through the audit repository produces a row with actor, tenant, action and diff (test), and `organization.metadata` round-trips as JSON.

### §2.3 Committed migrations (stop `db:push` as the schema mechanism)

**Context.** The `drizzle/` output directory does not exist and is even gitignored. Production must never be provisioned with `db:push`; committed, reviewable SQL migrations are required. CI currently has no working schema step at all (see §5.1 for the broken workflow bug).

**Refs:** docs/v1/analysis.md §1.6, §7; docs/v2/analysis.md §8; docs/v2/roadmap.md §0.5; docs/v3/architecture.md §14.3.

**Work:**

- `bun --filter @opensaas/database db:generate` for every schema change in this roadmap; commit the SQL under `packages/database/drizzle/`.
- Remove the `.gitignore` entries hiding migration artifacts (`drizzle/*.sql`, `.drizzle/` as applicable).
- Reserve `db:push` for throwaway local experiments; document generate → review → `db:migrate` as the only supported path (docs/v3/architecture.md §14.3 already says so — make it possible).
- CI switches from push to migrate in §5.1.

**AC:**

- [ ] A fresh clone plus `DATABASE_URL=… bun --filter @opensaas/database db:migrate` produces the complete schema — no `db:push` needed.
- [ ] `git status` is clean after running `db:generate` against an up-to-date database (no untracked drift).
- [ ] Migrations for every change in Phases 2–4 exist as committed, reviewable SQL files.
- [ ] `db:push` is documented as local-dev-only in the package scripts or CONTRIBUTING (§5.5).

### §2.4 Client factory and connection discipline

**Context.** `packages/database/src/client.ts` reads `process.env.DATABASE_URL` raw, throws at import when it is missing (making the package unusable without a full environment), configures no pool options and no timeouts, and never exposes a way to close the connection — so graceful shutdown is impossible and imports are side-effectful.

**Refs:** docs/v1/analysis.md §2.4, §4 (graceful shutdown, factory rows); docs/v2/analysis.md §2.10, §3.3, §3.4; docs/v3/architecture.md §15.3; docs/v2/roadmap.md §2.2.

**Work:**

- `createDb(config)` factory; the exported `db` becomes a lazily-initialized default for convenience, overridable by injection (§1.2, §4.7).
- Pool options from validated `env` (add to `envSchema`, §1.1): max connections, idle timeout, statement timeout, connect timeout — with safe defaults, no hardcoded values.
- Remove the raw `process.env.DATABASE_URL` read and the import-time throw; validation happens when the factory is invoked.
- Export `close()` (wrapping `client.end()`) for graceful shutdown (§4.8).
- Keep `withTransaction`, and extend it to carry the tenant GUC (Phase 2.5, §2.5.2).

**AC:**

- [ ] `grep -rn "process.env" packages/database/src --include="*.ts"` returns nothing outside tests.
- [ ] Importing `@opensaas/database` without env does not throw; invoking the factory does, with a clear message.
- [ ] Pool settings are read from validated env; a test asserts custom values reach the underlying client configuration.
- [ ] `close()` resolves and leaves no open handles (a test process exits cleanly after calling it).

### §2.5 Connection resilience: retry, backoff, circuit breaker

**Context.** The client has no pool configuration, no timeouts, no retry policy and no circuit breaker. An unresponsive database makes callers hang (the health endpoint today, §4.6) instead of failing fast; transient errors take down requests that could have succeeded on a second attempt.

**Refs:** docs/v1/analysis.md §3 (Circuit breaker / retry row); docs/v2/analysis.md §4 (same row), §8; docs/v2/roadmap.md §2.2.

**Work:**

- **Startup:** bounded retry-with-backoff (jittered) on the initial connection; after the last attempt, fail with a clear typed error instead of an opaque driver message.
- **Transient errors:** retry policy for idempotent operations (reads and single-statement idempotent writes) with jittered backoff; **non-idempotent writes are never retried** unless the caller supplies an idempotency key (§4.9) — document the policy.
- **Circuit breaker** on the client: consecutive-failure threshold → `open` → requests fail fast with a typed 503 `AppError` instead of piling up → `halfOpen` after a cooldown → a successful probe closes it. Config knobs (thresholds, cooldown, probe timeout) live in `envSchema` with safe defaults; the breaker is disabled or trivially closed in unit tests.
- Expose breaker state + counters as hooks so §5.6 can publish them to `/metrics`.

**AC:**

- [ ] With the DB unreachable at boot: N bounded retries with backoff, then a clear failure message (test against a closed port).
- [ ] After the configured number of consecutive failures the breaker opens and the next call fails fast (well under the statement timeout); after the cooldown a probe closes it — unit-tested with an injected clock/sleeper.
- [ ] While the breaker is open, `/readyz` reports not-ready (wired in §4.6).
- [ ] A non-idempotent write is not retried after a mid-flight failure (test with a fault-injected driver fake).
- [ ] All knobs come from validated env; defaults are documented in `.env.example` (§5.3).

### §2.6 Safe query inputs (wildcard injection)

**Context.** Search input is interpolated into `ilike` patterns without escaping `%` and `_` (`packages/database/src/contacts.ts:41`), so a user can inject wildcards and match unintended rows or degrade performance. This is a classic pattern-injection bug in every future search feature unless a convention exists.

**Refs:** docs/v1/analysis.md §5 (wildcard injection); docs/v2/analysis.md §6; docs/v2/roadmap.md §1.3 (AC4).

**Work:**

- Add an escaping helper (escape `\`, `%`, `_`) and apply it to every `ilike` pattern built from user input in the contacts search (and any future search).
- Document the convention in the repository playbook (docs/v3/architecture.md §14.2 gets a note via §5.5): raw user input never reaches a LIKE pattern unescaped.
- Bounding of `metadata` depth/size is request-schema work and lives in §4.4/§4.5; note the cross-reference.

**AC:**

- [ ] Searching for `100%` matches a contact literally named `100%`; searching for `_` matches a literal underscore (integration tests).
- [ ] The helper has unit tests covering `\`, `%`, `_`, and unicode input.
- [ ] No other `ilike` call site in the package builds a pattern from unescaped user input (grep + review).

### §2.7 Database test isolation

**Context.** `packages/database/src/__tests__/setup.ts` is imported by no test file, truncates a table named `"branch"` while the real table is `"branches"`, and hides the failure behind an empty `catch {}` — a false sense of isolation. Project-wide, tests write to the developer's real database through the auto-loaded `.env` and never clean up (the `pre-commit` hook therefore mutates dev data on every commit — fixed in §5.4).

**Refs:** docs/v1/analysis.md §1.9, §4 (item 1), §6; docs/v2/analysis.md §1.9, §2.2, §2.7; docs/v2/roadmap.md §1.5.

**Work:**

- Fix or delete the setup file: correct table names (`branches`), no empty `catch`, and it must actually be imported by the suites that need it.
- Integration tests use a dedicated `DATABASE_URL_TEST` (env var added to `envSchema`/`.env.example` as required only in test contexts), never the dev `DATABASE_URL`.
- Cleanup after each suite (TRUNCATE or transactional rollback, whichever fits the flow), with a guard that fails loudly if the target DB is not the test database.
- The project-wide `test:unit` / `test:integration` split and hook policy are §5.4; this item only owns the database package's own machinery.

**AC:**

- [ ] The setup module is imported where used (or removed entirely); `grep` shows no empty `catch` in test setup.
- [ ] Running the database package suite twice in a row leaves the test DB in its pre-run state (row counts identical).
- [ ] A guard test fails if `DATABASE_URL` (not `DATABASE_URL_TEST`) is used by any integration test.
- [ ] No test reads the developer's `.env` database.

### §2.8 Remove the health mock from the data layer

**Context.** `packages/database/src/health.ts` returns a mocked `true` when `NODE_ENV === "test"`, so the API can report a healthy database that is down. "Is it healthy?" is an application concern; a test mock inside the data layer is both misplaced and dangerous. The honest probe (with timeout) is implemented in the app in §4.6.

**Refs:** docs/v1/analysis.md §1.10, §4 (item 2); docs/v2/analysis.md §1.10, §5 (item 2); docs/v3/architecture.md §15.3.

**Work:**

- Delete the `NODE_ENV === "test"` branch; remove `health.ts` or reduce it to an injected-option probe (e.g. `checkDatabaseHealth({ timeoutMs })`) with no environment branching.
- The readiness endpoint and its test-mode behavior live in `apps/api` (§4.6).

**AC:**

- [ ] `grep -rn "NODE_ENV" packages/database/src --include="*.ts"` returns nothing.
- [ ] No code in the data layer claims health status based on the environment.
- [ ] Behavior parity is delivered by §4.6's ACs (503 within timeout when the DB is down, in every environment).

---

## 5. Phase 2.5 — Postgres Row-Level Security (second line of defense)

> **Why a dedicated phase:** application-level scoping (`WHERE organization_id = …`) is the floor, but a single forgotten filter leaks another tenant's data — and the audit trail shows that scoping today lives only in route/repository code (docs/v2/analysis.md §3.7, docs/v3/architecture.md §10.2). This phase makes the **database itself** refuse cross-tenant access, even for a buggy query builder or a forgotten `WHERE`.
> **Scope:** business tables only — `contacts`, `branches`, `audit_log`. Better Auth's seven tables are framework-owned (docs/v3/architecture.md §11.1) and are queried by the framework without tenant context (e.g. `session` by token); enabling RLS on them is a separate decision recorded as an ADR in §5.5, not part of this phase's required scope.
> **Relationship to app-layer rules:** membership verification and RBAC are HTTP-layer concerns and live in §4.3. RLS **complements** them; it does not replace them, and vice versa.
> Exit gate: with the feature flag on, no connection using the application role can read or write another tenant's rows in the business tables, even when the SQL omits `organization_id`.

### §2.5.1 RLS policies and feature-flagged migration

**Context.** No RLS exists on any table (docs/v1/analysis.md §2.7, docs/v2/analysis.md §3.7). Enabling it naively breaks the app (and Better Auth) unless the application role, the GUC and the rollout are designed together, so policies ship behind a flag.

**Refs:** docs/v1/analysis.md §2.7; docs/v2/analysis.md §3.7 (no Postgres RLS); docs/v2/roadmap.md §2.6 (RLS as second line of defense, `SET LOCAL app.current_org`); docs/v3/architecture.md §10.2.

**Work:**

- Roles: a dedicated application role (`opensaas_app`, no `BYPASSRLS`, no ownership of the tables) used by the runtime client; DDL/migrations run as a separate owner role (table owners bypass RLS unless `FORCE` is set — use `FORCE ROW LEVEL SECURITY` and the dedicated role to make the semantics explicit).
- Policies on `contacts`, `branches`, `audit_log`: `USING (organization_id = current_setting('app.current_org', true)::text)` and `WITH CHECK` with the same predicate. With the GUC unset, `current_setting(..., true)` is `NULL` and the predicate is false — **deny by default**.
- The enabling migration (`ENABLE/FORCE ROW LEVEL SECURITY` + roles + policies) is generated, committed (§2.3) and applied **conditionally** by a documented deploy step tied to a feature flag (`RLS_ENABLED`, see §2.5.4), with a committed disable/rollback migration.
- Decide and document the connection model: the runtime client connects as `opensaas_app`; migrations/studio use the owner role.

**AC:**

- [ ] With RLS enabled, a query as the application role on `contacts` **without** setting the GUC returns zero rows (deny-by-default proven by test).
- [ ] With the GUC set to org A, the same connection reads only org A's rows on all three business tables.
- [ ] The owner/migration role can still administer tables (documented and tested in the migration harness).
- [ ] The enabling migration exists, is committed, and is applied only when `RLS_ENABLED` is on; a committed rollback migration disables it.
- [ ] Better Auth's tables are untouched, and the decision ("business tables only") is recorded in the ADR (§5.5).

### §2.5.2 Tenant GUC plumbing in transactions

**Context.** RLS policies read `app.current_org`, but nothing sets it. The only sanctioned place to set a transaction-local GUC is the transaction helper that every tenant-scoped operation already funnels through.

**Refs:** docs/v2/analysis.md §3.7; docs/v2/roadmap.md §2.6 (the app sets `SET LOCAL app.current_org` per transaction); docs/v3/architecture.md §10.2.

**Work:**

- Extend `withTransaction` (§2.4) to require/accept `organizationId` and execute `SELECT set_config('app.current_org', $1, true)` as the first statement of every tenant transaction.
- Provide the equivalent guard for single reads: tenant-scoped repository functions (§2.1) run through a tenant-transaction helper even when they do not open an explicit multi-statement transaction — so **every** repository call path carries the GUC.
- A repository call with no tenant context is a typed programming error (loud failure), never a silent permissive path.
- `organizationId` remains required at the type level (§2.1); the GUC plumbing makes the runtime match the type guarantee.

**AC:**

- [ ] Every tenant-scoped repository function executes with the GUC set (asserted by an integration test that inspects `current_setting` inside a probe query, or by an isolation test).
- [ ] GUC never leaks across requests on a pooled connection: two sequential queries for org A then org B on the same connection see disjoint rows (test).
- [ ] An unset GUC (raw connection, no helper) sees zero rows (deny-by-default, overlaps §2.5.1).
- [ ] Calling a tenant-scoped function without an organization throws a typed error instead of querying unscoped.

### §2.5.3 Cross-tenant proof tests (the "buggy query builder" proof)

**Context.** The value of RLS is only real if it survives a mistake. docs/v2/roadmap.md §2.6 AC3 demands proof that cross-tenant reads fail *even with a buggy query builder* — i.e. even when application code forgets the filter entirely.

**Refs:** docs/v2/roadmap.md §2.6 (AC3); docs/v1/analysis.md §1.5; docs/v2/analysis.md §1.5, §3.7; docs/v3/architecture.md §16 (tenancy row).

**Work:**

- Negative integration tests executed as the application role with RLS on:
  - `SELECT * FROM contacts` with **no** `organization_id` filter → only current-org rows (or none), never another tenant's;
  - `INSERT INTO contacts (organization_id, …)` with another org's id under org A's GUC → rejected by `WITH CHECK`;
  - `UPDATE` / `DELETE` without a filter → affected rows limited to the current tenant (zero for foreign rows);
  - a deliberately "buggy" repository call (helper that omits the filter) is still isolated.
- These tests run in a CI job/DB configuration with the flag on (§5.1 wires the flag into the pipeline).

**AC:**

- [ ] The suite contains one test per case above (read-no-filter, cross-tenant insert, cross-tenant update/delete, buggy-repository simulation).
- [ ] The proof tests run in CI with RLS enabled, and fail if RLS is silently off (guard: assert `rowsecurity = true` on the three tables at test start).
- [ ] The app-layer tests of §4.3 still pass — defense in depth, not redundancy.

### §2.5.4 Rollout, feature flag and isolation-model documentation

**Context.** RLS changes runtime behavior for every query; enabling it is a rollout decision, and its guarantees and limits must be written down so contributors know which layer protects what.

**Refs:** docs/v2/analysis.md §3.7; docs/v2/roadmap.md §2.6 (AC2: architecture doc explains isolation guarantees and limits); docs/v3/architecture.md §10.2 (contributor rule).

**Work:**

- Flag `RLS_ENABLED` in `envSchema` + `.env.example` (§1.1, §5.3); default **off** in local dev until §4.4 adoption is complete, **on** in CI (§2.5.3) and staging, default **on** once Phase 4 is done.
- Rollout runbook: enable steps, verification query (`SELECT rowsecurity FROM pg_class …`), rollback (disable migration / flag off), and the "who is affected" note for long-lived connections (drain/restart).
- Write `docs/architecture/multitenancy.md` (content owned here, file created under the docs set of §5.5): the layered isolation model (route → tenant middleware → repository → RLS), what each layer guarantees, what it does **not** cover (Better Auth tables, RBAC), and the contributor rule from docs/v3/architecture.md §10.2.
- ADR: "RLS as the second line of defense" (§5.5).

**AC:**

- [ ] Runbook exists with enable, verify and rollback steps, and each step is executable as written (dry-run on staging).
- [ ] `docs/architecture/multitenancy.md` explains the guarantees **and the limits** of the model, including why Better Auth tables are out of scope.
- [ ] The feature flag is documented in the environment reference and `.env.example`.
- [ ] With the flag off, every non-RLS test suite still passes (no behavioral regression when disabled).

---

## 6. Phase 3 — `packages/auth` (auth domain)

> Domain policies, Better Auth wiring, registration. Everything here is HTTP-free and SQL-free except through Better Auth's own APIs and the database repositories (allowed by docs/v3/architecture.md §5.2 rules 2–3).
> Exit gate: registration is real (rows exist after a request), every registration mode is enforced **server-side**, modes are strategies instead of a `switch`, and the package contributes no dead code.

### §3.1 Registration that persists

**Context.** `POST /api/auth/register` validates input, evaluates the registration policy, returns `201 "Registration successful"` — and persists nothing: no user, no account, no waitlist record. It accepts a `password` and discards it. The existing test asserts the 201 response, cementing the illusion that registration works.

**Refs:** docs/v1/analysis.md §1.2, §6; docs/v2/analysis.md §1.2, §7; docs/v3/architecture.md §8, §12.3; docs/v2/roadmap.md §0.2.

**Work:**

- Implement the registration flow as functions in `packages/auth` (this package owns Better Auth wiring, docs/v3/architecture.md §5.3): call Better Auth `signUp` (creates `user` + `account` with a properly hashed password), then create the organization + membership (owner) through the organization plugin, then record the registration outcome per mode (§3.2).
- Persist waitlist status in a **project-owned** table — do not add columns to Better Auth's `user` table (docs/v3/architecture.md §11.1 warns against reshaping framework tables); the migration ships with §2.3.
- The raw password is never stored, returned or logged (Better Auth handles hashing).
- Duplicate email → a clean 409/422 with a stable code, never a 500.
- HTTP wiring (route → service → this flow) is §4.2/§4.4; this item owns the flow itself.

**AC:**

- [ ] A completed registration produces a `user` row and an `account` row with a hashed password; the plaintext appears nowhere in the DB, logs or response.
- [ ] An organization + `member` (role `owner`) row exist for the new user after registration.
- [ ] In `waiting_list` mode the waitlist status is **persisted** (queryable row), not just a response message.
- [ ] Registering the same email twice yields 409/422 with a stable error code (no 500, no partial rows — transactional, §2.4/§4.4).
- [ ] An HTTP integration test asserts the DB rows after the request (this test does not exist today because nothing persisted).

### §3.2 Server-side guarantees for invite codes and payment

**Context.** `paid_required` trusts a client-sent `hasPaid: true` — a complete payment bypass. `invite_code` only checks that the code is non-empty; any string passes (the source comment admits it). Both are server-trust violations on the most security-sensitive endpoint.

**Refs:** docs/v1/analysis.md §1.3, §1.4; docs/v2/analysis.md §1.3, §1.4; docs/v3/architecture.md §12.3; docs/v2/roadmap.md §0.3.

**Work:**

- Remove `hasPaid` from the client-facing DTO entirely (no request field may assert payment — enforced by schema).
- `invite_code`: validate against the `invitation` table (or a dedicated codes table): exists, not expired, status pending, consumed exactly once — atomically, inside a transaction (§2.4) with the registration flow (§3.1).
- `paid_required`: define a `PaymentVerificationPort` (`verify(ctx) → { verified, reference? }`) with a **deny-by-default** implementation (returns "not verified") until a provider is integrated (provider integration is explicitly out of scope — see the excluded list); registration is refused with 403 `PAYMENT_REQUIRED` otherwise. The port is the seam a future Stripe/checkout integration plugs into.
- Contract rule (docs/v3/architecture.md §12.4 note): a registration strategy MUST verify its constraint server-side; request payload flags are never trusted.

**AC:**

- [ ] No field in the register DTO can assert payment (schema test: the field does not exist).
- [ ] An invalid, expired or already-used invite code is rejected with a stable code; a valid one is consumed exactly once — including under concurrent requests (parallel-request test).
- [ ] With the default (deny-by-default) payment port, `paid_required` always refuses with 403 `PAYMENT_REQUIRED` (test).
- [ ] Unit tests cover each of the four registration modes end-to-end through the policy/strategy layer.

### §3.3 Strategy registry for registration modes

**Context.** Modes are dispatched by a rigid `switch` in `validateRegistrationAccess()`; adding a mode requires editing the switch. The intended pattern — Strategy + Registry — is designed in docs/v3/architecture.md §12.4.

**Refs:** docs/v1/analysis.md §3 (Strategy + Registry row); docs/v1/technical-overview.md §7.3; docs/v2/analysis.md §4; docs/v3/architecture.md §12.4, §14.4.

**Work:**

- `RegistrationStrategy` interface (`mode` + `validate(ctx)`), one strategy file per mode (`public`, `waiting_list`, `invite_code`, `paid_required`), and a `StrategyRegistry` (map keyed by mode) replacing the `switch`.
- Exhaustiveness enforced at compile time (`satisfies Record<RegistrationMode, RegistrationStrategy>` or equivalent), so a new union member without a strategy fails `tsc`.
- Unknown/unregistered mode at runtime → typed error; an invalid configured mode already fails at boot (§1.1).
- The invite/payment server-side rules from §3.2 live inside the corresponding strategies.

**AC:**

- [ ] Adding a mode requires: one union member, one new strategy file, one registry entry — no edits to existing strategies (verified by updating the recipe in docs/v3/architecture.md §14.4 to the new pattern, §5.5).
- [ ] A union member without a strategy fails typecheck (exhaustiveness test or compile-fail fixture).
- [ ] The registry fails fast at boot if a configured mode has no strategy.
- [ ] All existing mode tests pass unchanged in behavior.

### §3.4 Harden the Better Auth configuration

**Context.** The instance enables `emailAndPassword` and installs the `organization` and `bearer` plugins, but leaves unused what the framework already provides: rate limiting (disabled by default), `trustedOrigins` (CSRF/origin checks) and `databaseHooks`. Additionally there is no email verification, no password reset and no session rotation (docs/v1/analysis.md §5).

**Refs:** docs/v1/analysis.md §5; docs/v2/analysis.md §2.6, §6; docs/v3/architecture.md §12.1; docs/v2/roadmap.md §1.3 (interim note: use the built-in limiter before writing your own).

**Work:**

- Enable and configure the built-in rate limiter (per-route-class windows; auth endpoints first) — values from `env`.
- Configure `trustedOrigins` from `env` (the same allowlist feeds the API CORS in §4.5).
- Wire `databaseHooks.beforeCreateSession` for session telemetry (§3.5) and, where useful, audit events (§1.6, §4.4).
- Enable email verification and password reset flows: the endpoints come with the mounted handler (§4.1); sending is behind an injectable email **sender** port with a capturing fake for tests — actual delivery providers are part of the excluded messaging milestone, so production config ships with a clearly-labeled non-delivering default.
- Session policy: sane `expiresIn`/`updateAge`, and session rotation on password change.

**AC:**

- [ ] N consecutive failed sign-in attempts → 429 with `Retry-After` (integration test with lowered limits).
- [ ] A cookie-based flow from an origin outside `trustedOrigins` is rejected (test).
- [ ] Email verification and password reset complete end-to-end in integration tests using the capturing fake sender; no verification link/token is logged.
- [ ] A password change invalidates/rotates existing sessions (test).
- [ ] Every new knob comes from validated `env` (§1.1), and `grep -rn "process.env" packages/auth --include="*.ts"` returns nothing outside tests.

### §3.5 Session telemetry: wire it up or delete it

**Context.** `packages/auth/src/telemetry.ts` (68 lines, with tests) and the **nine telemetry columns** on the `session` table (`browser`, `os`, `deviceType`, `language`, `timezone`, `country`, `city`, `ipAddress`, `userAgent`) are entirely dead: `tenant.ts:1` imports `extractTelemetryFromHeaders` and never uses it. Every schema column must be written by at least one code path — or removed.

**Refs:** docs/v1/analysis.md §4 (item 6); docs/v2/analysis.md §5 (item 7), §2.6 (`databaseHooks` is the missing piece); docs/v3/architecture.md §16 (dead-code row).

**Work:**

- Decision + implementation. Recommended: **wire it** via `databaseHooks.beforeCreateSession` (§3.4), filling the columns derivable from the request (headers/UA/IP). Columns with no data source without an external service (e.g. geo lookup) are either dropped by migration (§2.3) or wired if a source exists — the outcome must leave **no always-null column**.
- Remove the unused import in `apps/api/src/middleware/tenant.ts:1` (that middleware is rewritten in §4.3 anyway).
- Record the decision in the item's PR and keep the ADR list (§5.5) consistent.

**AC:**

- [ ] Every column of the `session` table is written by at least one real code path (verified by test or audit query), or the column is gone via migration.
- [ ] `grep -rn "extractTelemetryFromHeaders" apps packages` shows only the wiring site (no unused imports).
- [ ] `knip` (or the manual audit of §5.4) reports no unused exports in `packages/auth`.
- [ ] The session-creation hook populates the wired columns for a real sign-in (integration test).

### §3.6 Disposable-domain policy from validated config

**Context.** `packages/auth/src/email-policy.ts:18` reads `DISPOSABLE_EMAIL_DOMAINS` from raw `process.env`, bypassing validation — a second source of truth next to the `env` singleton.

**Refs:** docs/v1/analysis.md §2.3; docs/v2/analysis.md §3.3; docs/v3/architecture.md §13.

**Work:**

- Read `DISPOSABLE_EMAIL_DOMAINS` from `env` (§1.1), parse and validate it (comma-separated list, normalized to lowercase), and merge it with the built-in blocked-domain list.
- Keep the existing normalization/anti-abuse tests green; add cases for env-provided domains.

**AC:**

- [ ] `grep -rn "process.env" packages/auth --include="*.ts"` returns nothing outside tests.
- [ ] An env-provided domain blocks registration with the same 422 `DISPOSABLE_EMAIL_REJECTED` path as built-ins (test).
- [ ] `DISPOSABLE_EMAIL_DOMAINS` is documented in `.env.example` (§5.3 completes the file audit).

---

## 7. Phase 4 — `apps/api` (HTTP surface)

> Composition: mount the auth surface, close the tenancy holes, introduce the service layer, run the middleware pipeline, complete the API contract, and add a GraphQL layer over the CRM domain.
> Exit gate: a session obtained over HTTP can call tenant-scoped routes end-to-end; cross-tenant and RBAC negative tests pass; routes are thin adapters over services; one error serializer exists; the contract is versioned and documented.

### §4.1 Mount the Better Auth HTTP surface

**Context.** `betterAuth(...)` is instantiated but never mounted: the line `app.all("/api/auth/*", (c) => auth.handler(c.req.raw))` does not exist. There is no sign-in, sign-out, sign-up or get-session endpoint; organization endpoints are unreachable; and because `auth.api.getSession()` always resolves to `null` over HTTP, **every `/api/contacts*` route returns 401 forever**. Multi-tenant isolation has never been exercised through the HTTP stack with a real session.

**Refs:** docs/v1/analysis.md §1.1; docs/v2/analysis.md §1.1; docs/v3/architecture.md §12.1, §19.2; docs/v2/roadmap.md §0.1.

**Work:**

- Mount the handler in `apps/api/src/index.ts` **before** any custom `/api/auth/*` routes, with a base URL consistent with `env.BETTER_AUTH_URL`.
- Verify no shadowing: the custom policy-gated register endpoint (§4.2) must coexist with Better Auth's own sign-up — if paths collide, move the custom endpoint to a documented path (decision recorded in the ADR/§5.5 docs).
- Expose the organization plugin endpoints (create org, memberships, invitations) — they are part of the auth surface the product needs (docs/v3/architecture.md §19.2).
- Bearer plugin stays enabled for stateless clients; session cookie flow is the default.

**AC:**

- [ ] `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session` all respond correctly over HTTP (integration tests).
- [ ] An HTTP integration test obtains a real session cookie via sign-in and calls `GET /api/contacts` successfully — 200, not 401 (this single test proves the biggest gap in the project is closed).
- [ ] Organization endpoints are reachable and covered by at least one happy-path test each.
- [ ] Tests assert both the Better Auth endpoints and the custom register endpoint respond (no shadowing), and any path decision is documented.

### §4.2 Thin register route; one error path; honest statuses

**Context.** The register route contains a local `catch` that maps any thrown error to 400 — masking real 500s from monitoring — and duplicates the global `app.onError` handler with different semantics. `GET /api/contacts` calls `contactsQuerySchema.parse(...)` raw, so `?limit=abc` throws a `ZodError` that surfaces as 500 instead of 422. There is no `app.notFound()`: unknown routes return Hono's plain text, breaking the JSON contract. `REGISTRATION_MODE` is read from raw `process.env` here (`routes/auth.ts:46`).

**Refs:** docs/v1/analysis.md §1.11, §2.5; docs/v2/analysis.md §1.11, §2.1, §3.5, §3.3; docs/v3/architecture.md §9.3, §14.1; docs/v2/roadmap.md §0.7, §1.2.

**Work:**

- Delete the local `catch`; `app.onError` (using the core helpers from §1.3) is the single serializer.
- The register route becomes: DTO validation (`zValidator` / `safeParse`) → registration service call (§4.4, backed by §3.1) → `ok(...)` envelope.
- Replace the raw `.parse()` on query params with `safeParse` → `ValidationError` (422) with field details; audit the package for any other raw `.parse()` on untrusted input.
- Register `app.notFound()` returning the JSON error envelope.
- Read the registration mode from validated `env` (§1.1), not `process.env`.

**AC:**

- [ ] An internal failure (e.g. DB down) returns 500 `INTERNAL_SERVER_ERROR` in the response and in the logs — never 400 (fault-injection test).
- [ ] `GET /api/contacts?limit=abc` and `?page=-1` return 422 with field details, never 500 (tests).
- [ ] An unknown route returns JSON `{"success":false,"error":{"code":"NOT_FOUND",…}}`.
- [ ] `grep -rn "success: false" apps/api/src/routes` → no route builds an error envelope by hand.
- [ ] No raw `.parse()` on request-derived data remains in `apps/api/src` (grep + review).

### §4.3 Close the multi-tenancy holes (membership, branch ownership, RBAC)

**Context.** `tenantContextMiddleware` accepts `x-branch-id` from anywhere without checking that the branch belongs to the organization (cross-tenant corruption on write); never verifies that the user is a **member** of `session.activeOrganizationId` (the `member` table is never queried → tenant escalation); and there is no RBAC at all — `owner`/`admin`/`member` roles exist in the schema and are never read. Zero negative HTTP tests exist for any of this.

**Refs:** docs/v1/analysis.md §1.5, §2.8; docs/v2/analysis.md §1.5, §3.8, §7; docs/v3/architecture.md §10.1, §10.2, §16; docs/v2/roadmap.md §0.4, §2.6.

**Work:**

- Membership check: before `next()`, verify the user has a `member` row for `activeOrganizationId`; attach `role` to the tenant context; otherwise 403.
- Branch ownership: if `x-branch-id` (header) or `branchId` (query) is present, verify the branch belongs to the active organization — 403/404 otherwise — on **every** route that accepts it.
- Membership cache: short-TTL cache (configurable) of `(userId, orgId) → role`, invalidated on role change / membership removal (hooks via Better Auth `databaseHooks` or explicit invalidation in the service layer); documented TTL.
- RBAC middleware `requireRole(...)` driven by `member.role`, plus a documented permission matrix (e.g. bulk import and contact deletion restricted to `owner`/`admin`); at least one differentiated permission enforced in code.
- Rewrite the middleware (this also removes the dead telemetry import, §3.5) and keep it the single session → tenant resolver (invariant, §2).
- These checks complement RLS (Phase 2.5): HTTP-layer authorization vs DB-layer isolation.

**AC:**

- [ ] A session whose `activeOrganizationId` the user does not belong to receives 403 (HTTP test).
- [ ] `x-branch-id` pointing at another organization's branch is rejected (403/404) on create and list (HTTP tests).
- [ ] A `member`-role user is denied the RBAC-gated operation (e.g. bulk import) with 403; an `admin`/`owner` succeeds (tests for both directions).
- [ ] The membership check is cached with a documented TTL; a role change invalidates the cache (test).
- [ ] Negative tests exist for every case above and run in CI (§5.4).

### §4.4 Service layer, DTOs, transactions and audit emission

**Context.** The flow is `route → repository` directly; business logic (registration composition, tenant composition) lives in HTTP handlers. Zod schemas are mixed with domain types. `withTransaction` is unused by any caller. Nothing emits audit events.

**Refs:** docs/v1/analysis.md §2.1, §4 (layered architecture, DTO, Unit of Work rows); docs/v2/analysis.md §3.1, §4; docs/v3/architecture.md §6.1, §6.2, §15.1; docs/v2/roadmap.md §1.1.

**Work:**

- Create `apps/api/src/services/` following the migration path of docs/v3/architecture.md §15.1: start with `registration.service.ts` (adapting the §3.1 flow), then `contacts.service.ts`, `branches.service.ts`.
- Routes become thin HTTP adapters: parse/validate DTO → call service → serialize envelope. No business branching, no direct repository imports.
- DTO layer: request/response Zod schemas distinct from domain entities, with explicit mappers (`toContactDto(row)`); cap `metadata: z.record(z.any())` with a depth/size limit (422 on violation).
- Transactions: registration (§3.1) and bulk create run inside `withTransaction` (§2.4) with the tenant GUC for RLS (§2.5.2); rollback on any mid-flow failure.
- Audit emission: services call `AuditPort` (§1.6) for contact create/update/delete, bulk import, registration, membership/role changes — actor, tenant, entity, diff.

**AC:**

- [ ] `grep -rn "from \"@opensaas/database\"" apps/api/src/routes` → no repository imports in routes.
- [ ] No route handler contains business branching (review checklist: routes contain validation, one service call, envelope only).
- [ ] Registration and bulk create execute in a single transaction; a mid-flow failure leaves zero partial rows (test).
- [ ] Creating and deleting a contact writes an audit row containing the acting user id and the tenant (test with a recording fake or the DB).
- [ ] A `metadata` payload deeper/larger than the documented cap is rejected with 422 (test).

### §4.5 Cross-cutting middleware pipeline

**Context.** There is no CORS, no security headers, no rate limiting, no body-size limit, no request-id and no request logging (only errors are logged). The bulk endpoint has no `max` on its array — a single request can insert millions of rows. Better Auth's built-in protections are enabled in §3.4; the API needs the rest of the pipeline around them.

**Refs:** docs/v1/analysis.md §2.6, §5 (security checklist); docs/v2/analysis.md §3.6, §6, §2.6, §7; docs/v3/architecture.md §15.2, §14.6; docs/v2/roadmap.md §1.3.

**Work:**

- Pipeline order (docs/v3/architecture.md §15.2): `request-id → access logger → secureHeaders() → CORS → rate limit → body size limit → auth (handler + getSession) → tenant (§4.3) → RBAC (§4.3) → route validation`.
- CORS allowlist from `env` (same source as `trustedOrigins`, §3.4); `secureHeaders()` from Hono.
- Rate limiting: rely on Better Auth's limiter for auth routes first (§3.4); add a write-endpoint limiter (per session/IP) with `Retry-After` semantics.
- Body-size limit globally; `max` on the `/contacts/bulk` array; the `metadata` cap is schema-level (§4.4).
- Request-id middleware feeds the §1.4 context; access logging emits exactly one structured line per request (fields formalized in §5.6).
- Wildcard escaping (§2.6) is already handled at the repository layer; note it in the pipeline docs so future validators don't bypass it.

**AC:**

- [ ] Every response carries `x-request-id` and the security headers (test).
- [ ] Login/register return 429 with `Retry-After` after the configured threshold (test).
- [ ] An oversized body is rejected with 413; a bulk payload over `max` is rejected with 413/422 (tests).
- [ ] CORS: an allowed origin passes; a disallowed origin is blocked (tests).
- [ ] One structured access-log line per request, containing method, path, status, duration, request-id and tenant id — and never bodies or PII (capture-and-assert test).

### §4.6 Health checks: liveness vs readiness

**Context.** A single `/api/health` endpoint performs a database roundtrip **with no timeout** (it hangs when the DB is unresponsive — the opposite of what a health endpoint is for), and the probe behind it lies in test environments (§2.8). There is no separation between "process is up" and "dependencies are ready".

**Refs:** docs/v1/analysis.md §1.10, §7; docs/v2/analysis.md §1.10, §4 (separated health checks row); docs/v2/roadmap.md §0.7; docs/v3/architecture.md §15.3.

**Work:**

- `/healthz` — liveness: process is up, no dependencies, always fast.
- `/readyz` — readiness: database probe **with a timeout**, honest in every environment (no mocks, §2.8), plus the circuit-breaker state (§2.5): breaker open → 503.
- Keep `/api/health` as an alias of readiness (or deprecate it with a `Deprecation` header and a doc note — decision recorded here and in §5.5 docs).

**AC:**

- [ ] With the database stopped, `/readyz` returns 503 within the configured timeout (no hang) — test against a closed port; `/healthz` still returns 200.
- [ ] With the circuit breaker open, `/readyz` returns 503.
- [ ] No environment-dependent mock makes the probe report a healthy database that is down (grep + test in the test environment).
- [ ] Health endpoints respond without authentication and without tenant middleware (regression test).

### §4.7 Context types and DI slots

**Context.** `apps/api/src/types.ts` re-declares `user` and `session` shapes by hand — they will drift silently as soon as the auth config changes — and declares `env` / `db` in `AppVariables` that are **never assigned** (dead DI scaffolding). `apps/api/src/index.ts:1` imports `ApiResponse` and never uses it.

**Refs:** docs/v1/analysis.md §4 (items 5, 7); docs/v2/analysis.md §2.8, §5 (items 6, 8); docs/v3/architecture.md §15.3, §14.6 (step 4).

**Work:**

- Derive the `user` / `session` context types from Better Auth's exported types (or adapter inference) instead of hand-written copies.
- Actually assign `env` and `db` into `AppVariables` via the factories from §1.2 / §2.4 at boot — completing the DI story the dead slots documented — or delete the slots and record the decision; the recommended path is to assign them.
- Remove the unused `ApiResponse` import.
- Declare every key any middleware writes into the context (`user`, `session`, `tenant`, request context).

**AC:**

- [ ] No hand-duplicated session/user shapes remain: a change to the Better Auth config that adds a session field surfaces at compile time at the usage site (demonstrated by the change that wired telemetry, §3.5, or a compile test).
- [ ] `grep -n "ApiResponse" apps/api/src/index.ts` → clean.
- [ ] Every `c.set(...)` has a matching declared type; no `any` context values (typecheck + review).
- [ ] The assigned `env`/`db` slots are used by at least one consumer, or the slots are gone (no dead scaffolding).

### §4.8 Graceful shutdown

**Context.** `client.end()` is never called and there is no signal handling: in-flight requests die on deploy and connections are never drained.

**Refs:** docs/v1/analysis.md §3 (graceful shutdown row), §7; docs/v2/analysis.md §8; docs/v2/roadmap.md §2.2.

**Work:**

- Handle `SIGTERM`/`SIGINT`: stop accepting new connections, stop accepting new work (readiness flips to 503 first — ordering matters for load balancers), drain in-flight requests with a bounded timeout, close the database via `close()` (§2.4), flush logs, exit 0 (non-zero if the drain timed out).
- Make signal handling idempotent (a second signal forces immediate exit).
- Verify under `docker compose stop` (§5.2).

**AC:**

- [ ] An in-flight request completes successfully while the server is shutting down; a new connection is refused/rejected (test).
- [ ] The process exits within the drain timeout with no open handles (test harness can assert exit).
- [ ] Readiness flips to 503 **before** connections stop draining (ordering test or documented behavior).
- [ ] A forced second signal exits immediately without hanging.

### §4.9 Complete the CRUD surface, idempotency and cache headers

**Context.** `/api/contacts` exposes only `GET /`, `POST /` and `POST /bulk` — no `GET /:id`, no `PATCH`, no `DELETE` — and the `branches` table has no routes at all (the schema is ahead of the API). There are no idempotency keys on write endpoints and no cache validators on lists.

**Refs:** docs/v1/analysis.md §3 (idempotency row); docs/v2/analysis.md §2.3, §4; docs/v3/architecture.md §19.2; docs/v2/roadmap.md §2.3.

**Work:**

- Contacts: `GET /:id`, `PATCH /:id`, `DELETE /:id`, all tenant-scoped and RBAC-gated (§4.3) through the service layer (§4.4).
- Branches: list/create/update/delete backed by the §2.1 repository, same tenancy/RBAC rules.
- Idempotency keys on write endpoints (registration, create, bulk): `Idempotency-Key` header → stored key + response hash with TTL (small table via §2.3 migration, or the cache layer), replay returns the original response.
- `ETag`/`If-None-Match` (or `Last-Modified`) on list endpoints where safe.
- Update the API surface table in docs/v3/architecture.md §19.2 (§5.5 maintenance rule).

**AC:**

- [ ] Every verb exists, is documented and tested — including a cross-tenant denial and an RBAC denial per mutation.
- [ ] Replaying a POST with the same `Idempotency-Key` returns the original response and creates no duplicate rows (concurrent replay test).
- [ ] `GET` list with a matching `If-None-Match` returns 304 and an empty body.
- [ ] The schema-vs-API gap is closed: `branches` no longer has "no routes" (docs/v2/analysis.md §2.3).

### §4.10 Versioned contract: `/api/v1` + OpenAPI

**Context.** The API has no versioning, no machine-readable contract and no deprecation policy. The `{success, error}` envelope is typed in code only; clients discover it by reading the source.

**Refs:** docs/v1/analysis.md §8 (P2 API items); docs/v2/roadmap.md §2.3; docs/v3/architecture.md §9, §19.2.

**Work:**

- Introduce the `/api/v1` prefix for all product routes (health endpoints may stay unprefixed); define the compatibility behavior for old paths (redirect or `Deprecation` header) and document it.
- Generate OpenAPI 3.1 from the Zod schemas (`@asteasolutions/zod-to-openapi` or `zod-openapi`), publish `/api/v1/openapi.json` plus a Swagger UI page.
- CI drift check: regeneration produces no diff (wired in §5.1).
- Write the deprecation/versioning policy (shipped with the docs set, §5.5).

**AC:**

- [ ] `/api/v1/openapi.json` validates against the OpenAPI 3.1 spec (validator runs in CI).
- [ ] CI fails when route schemas and the published spec drift.
- [ ] The Swagger UI page is reachable and linked from the README (§5.5).
- [ ] All product routes are reachable under `/api/v1` with tests; the old-path behavior is implemented and documented.

### §4.11 GraphQL layer over the CRM domain

**Context.** docs/v2/roadmap.md listed GraphQL as an explicit non-goal; this roadmap **supersedes that decision for the CRM domain only**, enabled by the service layer (§4.4, docs/v3/architecture.md §15.1): GraphQL resolvers call the *same* services, so tenancy, RBAC, validation and audit rules are not duplicated. The auth surface stays REST-only (Better Auth), which is recorded in the excluded list.

**Refs:** docs/v2/roadmap.md §Explicit non-goals (superseded); docs/v3/architecture.md §15.1, §10.2 (isolation rules apply to every surface), §5.3 (`@opensaas/api` owns the HTTP surface); docs/v2/analysis.md §3.1 (the missing service layer is the prerequisite — closed by §4.4).

**Work:**

- Schema (SDL) covering CRM only: types `Contact`, `Branch`, `Organization`, pagination; queries (`contact`, `contacts`, `branch`, `branches`) and mutations mirroring §4.9 (create/update/delete contact, bulk import, branch CRUD).
- Transport: GraphQL Yoga (fetch-compatible, integrates with Hono) or `graphql-hono` — the choice is recorded in an ADR (§5.5). Endpoint: `/graphql`, mounted under the same pipeline as REST (§4.5): request-id, CORS, rate limit, body limit, session auth, tenant, RBAC.
- Resolvers delegate to services only — no business logic, no repository access, no second authorization path.
- Error mapping: `AppError` subclasses → GraphQL errors carrying the same stable `code`s; nullability rules for not-found documented (nullable field + error, or typed error — pick one, document it).
- Safety: query depth limiting + complexity/cost analysis (configurable via `env`); introspection enabled at least in non-production (documented choice); optional persisted queries noted as future work.
- Explicitly out of scope here: auth mutations (sign-up/sign-in/organizations) — those remain Better Auth REST endpoints (§4.1).

**AC:**

- [ ] Introspection exposes a schema that passes a standard validator; the SDL snapshot is committed and drift-checked in CI.
- [ ] An authenticated session queries its organization's contacts through GraphQL and gets the same data as the REST list endpoint (parity test).
- [ ] A cross-tenant attempt (contact id from another organization, or `branchId` of another org) returns no data — negative test through GraphQL (mirrors §4.3).
- [ ] A non-member session is rejected with 401-class semantics; a `member`-role user is denied the RBAC-gated mutation (tests mirroring §4.3).
- [ ] A pathologically deep/nested query is rejected by the depth/complexity limit with a typed error (test).
- [ ] `grep`/review rule: resolvers contain no business branching and no `@opensaas/database` imports.

---

## 8. Phase 5 — Complete project (cross-cutting)

> Infrastructure, tooling, documentation and operations. Most items can start in parallel with the package phases; the ones with prerequisites are marked. This phase contains no new product features — it makes the project maintainable, reproducible and welcoming to contributors.

### §5.1 CI pipeline: fix, reproducibility, security gates

**Context.** CI is broken: in `.github/workflows/ci.yml:47-50` the `run:` key is nested inside `env:`, so the "Run Database Push" step **executes nothing** (it becomes an environment variable) and the schema is never provisioned — the suite only survives because DB-touching tests are trivial or mocked. Beyond the bug: no install caching, `bun-version: latest` (not reproducible), no `concurrency` group, a hardcoded secret (`ci_secret_key_…`), no security job, no dependabot, no coverage gate.

**Refs:** docs/v1/analysis.md §1.6, §7; docs/v2/analysis.md §1.6, §8, §2.5; docs/v3/architecture.md §17.4; docs/v2/roadmap.md §0.5, §2.5.

**Prerequisite:** §2.3 (migrations) — the DB step becomes `drizzle-kit migrate`, not push.

**Work:**

- Fix the nested `run:`/`env:` bug; the step runs a real command and fails loudly on error.
- Switch the step to `bun --filter @opensaas/database db:migrate` against the CI Postgres service.
- Pin `bun-version` exactly; add Bun install caching; add a `concurrency` group with cancel-in-progress.
- Move the hardcoded secret to GitHub Secrets; no secrets remain in workflow files.
- Security jobs: dependency audit gate, CodeQL or Semgrep for TypeScript, `zizmor` for workflow linting, `gitleaks` secret scanning over full history.
- Dependabot (or Renovate) configuration for Bun + GitHub Actions.
- Coverage upload + gate wired to the §5.4 thresholds; OpenAPI drift check for §4.10; RLS-enabled test job for §2.5.3.
- Keep the pipeline order honest: install → lint → typecheck → migrate → unit → integration → security jobs.

**AC:**

- [ ] A deliberately broken migration fails the pipeline (test on a branch).
- [ ] `bun-version` is pinned and matches the local version pinned in §5.3.
- [ ] A PR introducing a known-vulnerable dependency fails CI.
- [ ] Secret scan runs on full history and passes on the current tree; `zizmor` passes on all workflows.
- [ ] Duplicate runs on stacked PRs are cancelled (concurrency group).
- [ ] Coverage is reported on every PR and the gate fails below the agreed floor.

### §5.2 Containers, CD and release engineering

**Context.** No Dockerfile, no docker-compose, no CD. The release process is coupled to a live local database (`release-it`'s `before:init` runs `bun test`, which needs `DATABASE_URL`) — cutting a release requires a developer machine with a dev DB.

**Refs:** docs/v1/analysis.md §7; docs/v2/analysis.md §8, §2.1, §2.2; docs/v2/roadmap.md §2.1, §3.3; docs/v3/architecture.md §17.2.

**Work:**

- Multi-stage `Dockerfile`: build with Bun, run a minimal non-root image, `HEALTHCHECK` wired to `/healthz` (§4.6).
- `docker-compose.yml` for local development: Postgres + API + `db:migrate` on boot, healthchecks, and a `--profile seed` that loads a demo organization, user, branches and contacts (seed data also powers the example script, §5.5).
- CD workflow triggered on tags: run the pipeline, build the image, push with semver tags, create the GitHub Release from the conventional changelog.
- Release engineering runs in CI only: remove the local-DB dependency from release-it hooks (`before:init` keeps lint/typecheck but not DB-backed tests, or runs them against the CI database).
- Semver policy documented; `changesets` intentionally **not** adopted (packages are internal — see excluded list).

**AC:**

- [ ] `docker compose up` gives a new contributor a working stack in one command (this is the README quickstart, §5.5).
- [ ] The container fails its healthcheck when the DB is down and passes once ready.
- [ ] A tag push produces: changelog entry, GitHub Release, semver-tagged image — entirely from CI.
- [ ] No release step requires a local database.

### §5.3 Dependencies, monorepo and configuration hygiene

**Context.** `zod` is undeclared where used (`apps/api`); `drizzle-orm ^0.36` sits outside Better Auth's optional peer range `^0.45.2` (an adapter compatibility risk, not an install failure); `packages/auth` and `packages/database` have **no `tsconfig.json`** so their `tsc --noEmit` climbs to the root and typechecks the whole repo (3× redundant work); strictness flags are uneven; `bun-types` (deprecated) is mixed with `@types/bun`; there is no `exports` map, no project references, no `engines`/`packageManager`; `biome.json` declares schema 1.8.3 while 1.9.4 is installed; `.env.test` declares `NODE_ENV="development"`; the local `.env` contains roadmap notes; local credentials should be rotated.

**Refs:** docs/v1/analysis.md §1.7, §1.8, §2.9, §4 (items 4, 9, 10); docs/v2/analysis.md §1.7, §1.8, §2.4, §3.9, §5 (items 4, 5, 10, 11); docs/v3/architecture.md §5.2, §13.2; docs/v2/roadmap.md §0.6, §1.6, §1.7.

**Work:**

- Declare `zod` in `apps/api` dependencies (core done in §1.5); verify no workspace relies on hoisting.
- Resolve the `drizzle-orm` / Better Auth optional-peer skew: upgrade `drizzle-orm` (preferred) and re-run the full auth + adapter test matrix; record the decision in an ADR (§5.5).
- Standardize the monorepo: `tsconfig.base.json` + per-package `tsconfig.json` with `extends` (adding the two missing ones), uniform strict flags including `noUncheckedIndexedAccess`, TypeScript project references, `exports` maps in every package `package.json`.
- Replace `bun-types` with `@types/bun` everywhere; remove `bun-types` from root.
- Pin `engines` and `packageManager`; align the pinned Bun version with CI (§5.1).
- Align `biome.json` schema version with the installed Biome.
- Config files: `.env.test` gets `NODE_ENV="test"`; move roadmap notes out of `.env` into the post-roadmap "Messaging platform" milestone (see tracking section); rotate local credentials (`admin:omarchy`); complete `.env.example` (every `envSchema` key: `REGISTRATION_MODE`, pool config §2.4, breaker knobs §2.5, `RLS_ENABLED` §2.5.4, CORS origins §4.5, rate limits §4.5, complexity limits §4.11).

**AC:**

- [ ] `bun run typecheck` runs each workspace exactly once against its own config (no root climb).
- [ ] `grep -rn "bun-types" . --include="*.json"` → nothing.
- [ ] Each workspace installs and typechecks in isolation (no hoisting reliance).
- [ ] `biome.json` schema version equals the installed Biome version.
- [ ] `.env.test` declares `NODE_ENV="test"`; no credentials in tracked files (gitleaks, §5.1); no roadmap content in any `.env*` file.
- [ ] A test iterates `envSchema` keys and asserts each is documented in `.env.example`.

### §5.4 Testing strategy and quality gates

**Context.** 44 tests pass but many are trivial; there are **zero** HTTP tests with an authenticated session; there is no unit/integration split (a down database turns the whole suite red); integration tests write to the developer's real database through the auto-loaded `.env` and never clean up; the `pre-commit` hook runs `bun test` against that database on every commit; tests mutate `process.env.REGISTRATION_MODE` between cases (order-dependent by construction); there is no coverage report, no gate, no fixtures/factories, and test placement is inconsistent (colocated vs `__tests__/`).

**Refs:** docs/v1/analysis.md §6, §4 (item 8); docs/v2/analysis.md §2.2, §2.7, §5 (item 9), §7; docs/v3/architecture.md §17.3; docs/v2/roadmap.md §1.5.

**Work:**

- Scripts: `test:unit` (no DB, must pass with the database stopped) and `test:integration` (dedicated `DATABASE_URL_TEST`, provisions/tears down its own schema, cleans up after each suite — building on §2.7).
- Remove `bun test` from `pre-commit` (keep lint/typecheck there; tests stay in CI; optional opt-in `pre-push`); decouple release hooks from the local DB (§5.2).
- Kill order-dependent `process.env` mutation: inject config instead (depends on §1.2).
- Decide the test-placement convention (colocated `*.test.ts` recommended) and move the stragglers (`packages/core/src/errors.test.ts`, `packages/database/src/schema.test.ts`).
- Factories/fixtures for organizations, users, branches and contacts with unique suffixes.
- Authenticated HTTP test matrix (completes the negative tests started in §4.3): cross-tenant branch, non-member session, RBAC denials, each registration mode, GraphQL negatives (§4.11), RLS proofs (§2.5.3).
- Coverage: `bun test --coverage` with a CI gate — baseline at the current floor, ratchet to ≥ 80% lines on `apps/api/src` and 100% on tenant/RBAC middleware.
- Dead-code audit with `knip` (or equivalent) in CI; the backlog items (§2.8, §3.5, §4.7) must be closed by the time the gate turns red on new dead code.

**AC:**

- [ ] `bun run test:unit` passes with no database running.
- [ ] `bun run test:integration` runs twice consecutively with no residue and never touches the dev database (guard test from §2.7).
- [ ] Coverage thresholds are enforced in CI and fail a PR that drops below the floor.
- [ ] No test mutates `process.env` without restore, or mutates it at all after the injection work (grep/CI rule).
- [ ] One placement convention; `grep` shows no stragglers outside it.
- [ ] `pre-commit` no longer runs the test suite (hook config verified in CI or a repo check).

### §5.5 Open-source collaboration and documentation

**Context.** The README is a single line. There are no architecture docs beyond this `docs/` tree, no ADRs, no CONTRIBUTING, no CODEOWNERS, no SECURITY, no CODE_OF_CONDUCT, no example client. Issue templates, a PR template and the MIT license already exist (keep them). The docs tree itself needs a maintenance rule, or docs/v3/architecture.md will drift from the code as phases land.

**Refs:** docs/v1/analysis.md §7; docs/v2/analysis.md §8; docs/v2/roadmap.md §3.1, §3.2, §2.5, §2.6; docs/v3/architecture.md §1, §14, §16.

**Work:**

- README rewrite: what it is, architecture diagram, quickstart (`docker compose up`), environment reference, curl examples, GraphQL pointer, badges (CI, license, coverage), link to the OpenAPI UI (§4.10).
- `CONTRIBUTING.md`: setup, unit vs integration test strategy (test DB!), migrations workflow (§2.3), commit/PR conventions, the layering rules (docs/v3/architecture.md §6.2) and the tenancy contributor rule (§10.2).
- `SECURITY.md` with a disclosure policy and contact.
- `CODE_OF_CONDUCT.md`, `CODEOWNERS`.
- `docs/architecture/`: overview + `multitenancy.md` (content from §2.5.4) + ADRs for: stack choices (Hono + Drizzle + Better Auth, monorepo, envelope contract), service layer, migrations-not-push, RLS (Phase 2.5), audit port + promotion rule (§1.6), GraphQL over CRM (§4.11), drizzle/better-auth version alignment (§5.3).
- Example client + seed: `docker compose --profile seed` demo data; `examples/` script demonstrating sign-up → create contact → list (REST) **and** one GraphQL query.
- Deprecation/versioning policy (§4.10) as a README/docs section.
- **Maintenance rule:** when a phase merges, the touched sections of docs/v3/architecture.md are updated in the same PR (as-is badges stay truthful); this roadmap is updated when an item's ACs change.

**AC:**

- [ ] A new contributor goes from clone to authenticated `GET /api/contacts` in under 15 minutes using only the README.
- [ ] GitHub's community profile check is green (all community health files present).
- [ ] `SECURITY.md` exists with a contact and scope.
- [ ] The example script runs against the compose stack with zero manual SQL, covering REST and GraphQL.
- [ ] Every decision listed above has an ADR.
- [ ] The maintenance rule is written in CONTRIBUTING and followed by at least one PR per phase (spot-checkable in history).

### §5.6 Observability, performance and operations

**Context.** Pino is configured but only invoked for errors and startup — there is no structured access log, no metrics, no tracing, no performance baseline. Tenancy correctness at scale needs the membership cache (§4.3) to be observable, and the RLS/ breaker changes (Phase 2.5, §2.5) need signals.

**Refs:** docs/v1/analysis.md §7, §8; docs/v2/analysis.md §4 (correlation row), §8; docs/v2/roadmap.md §2.4, §3.4, §2.6; docs/v3/architecture.md §15.2 (pipeline intent).

**Work:**

- Formalize the structured access log emitted by §4.5: method, path, route, status, duration, request-id, tenant id, user id — never bodies or PII; share the request-id with traces.
- `/metrics` (Prometheus): request duration histogram by route/status, DB pool stats, circuit-breaker state and trip counter (§2.5), auth outcomes (sign-in success/failure), rate-limit rejections, membership-cache hit ratio (§4.3).
- OpenTelemetry tracing behind an env flag (off by default): spans for request → middleware → service → DB, sharing the request-id.
- Alert-ready definitions documented: readiness, error rate, p95 latency thresholds (dashboard tooling itself is out of scope).
- Performance baseline: a k6/artillery smoke profile (sign-in, list contacts, bulk import), run manually and as a nightly job; record p50/p95 in `docs/performance.md`; the nightly job fails on > 50 % regression once the baseline is stable; add the query-plan regression check for the §2.2 indexes where practical.

**AC:**

- [ ] One request produces exactly one access-log line, and that line carries the same request-id as the trace/span when tracing is on.
- [ ] `/metrics` is scrapeable by Prometheus and exposes every series listed above (scrape-and-assert test).
- [ ] With the tracing flag off, no exporter is initialized (no overhead); with it on, a trace is exported end-to-end.
- [ ] A documented baseline (p50/p95 for the three scenarios) exists in `docs/performance.md`; the regression threshold is configured.
- [ ] Membership-cache hit ratio and breaker trips are visible on `/metrics`.

---

## 9. Out of scope — items not covered by these phases

The following items appear in the source documents but are **deliberately not part of Phases 1–5**. Each row states where it comes from and why it is excluded. Product-facing entries are collected into a **post-roadmap milestone: "Messaging platform"** (see §10) — they are features, not defects, and none of them blocks an item in this roadmap.

| # | Item | Source | Why it is excluded |
| --- | --- | --- | --- |
| 9.1 | **Messaging platform**: WhatsApp/WAHA channel automation, email providers and *actual email delivery* (verification/reset emails ship with a fake/capturing sender, §3.4), webhook engine, routing engines — the original "phases 3–6" that lived as notes in `.env` | docs/v1/technical-overview.md §1 (planned scope); docs/v2/roadmap.md §Suggested tracking; docs/v3/architecture.md §2 | New product capabilities requiring external services and business decisions; nothing in Phases 1–5 depends on them. Track as the post-roadmap "Messaging platform" milestone. |
| 9.2 | **Concrete payment provider integration** (Stripe/checkout session lookup, webhooks, credentials) | docs/v2/analysis.md §1.3 (the defect — fixed by §3.2); docs/v1/analysis.md §5 | Provider choice, credentials and billing policy are product/business decisions. Phase 3.2 delivers the `PaymentVerificationPort` with deny-by-default; the provider plugs into that seam later. |
| 9.3 | **GraphQL over the auth domain** (sign-up/sign-in/membership/invitation mutations) | docs/v2/roadmap.md §Explicit non-goals (partially superseded: CRM-only GraphQL is §4.11) | Better Auth owns those flows and its REST handler is the source of truth (docs/v3/architecture.md §11.1); a second auth surface would duplicate policy enforcement for no gain. |
| 9.4 | **Event bus / outbox** | docs/v1/analysis.md §3 (row); docs/v2/roadmap.md §Explicit non-goals | Deferred until the messaging milestone (9.1) has real consumers; the transactional `audit_log` (§2.2) keeps the door open, as docs/v2/roadmap.md already prescribed. |
| 9.5 | **Microservices split** | docs/v2/roadmap.md §Explicit non-goals | The monolith-in-packages structure is correct at this size (docs/v3/architecture.md §5); revisit only under concrete scaling pressure. |
| 9.6 | **Connection-per-tenant / database-per-tenant** | docs/v2/roadmap.md §2.6 (out of scope) | One shared database with RLS + app scoping is the isolation model (Phase 2.5, §2.5.4); per-tenant connections are a cost/ops decision with no current driver. |
| 9.7 | **Independent package publishing / `changesets`** | docs/v2/roadmap.md §3.3 (conditional) | All packages are internal (`workspace:*`, nothing published to a registry — docs/v3/architecture.md §5.2); release engineering (§5.2) covers the app, not a package registry. |
| 9.8 | **`packages/audit` as its own workspace** | decision recorded in §1.6 (hybrid design: port in core, table/repo in database, orchestration in api) | Premature at ~1.7k LOC; would add a workspace (tsconfig/exports/tests) for a thin wrapper. The promotion rule in §1.6 defines exactly when to create it (retention jobs, multiple sinks, query API). |

**Moved *into* the plan** (previously listed as non-goals or deferred, now required items): Postgres RLS (Phase 2.5 — was a stretch goal in docs/v2/roadmap.md §2.6), the DB circuit breaker (§2.5 — was a "missing pattern" row), and GraphQL over the CRM domain (§4.11 — was an explicit non-goal in docs/v2/roadmap.md).

---

## 10. Suggested tracking

- One GitHub **milestone per phase** (1, 2, 2.5, 3, 4, 5) and **one issue per item** (e.g. "§4.3 Close the multi-tenancy holes"), copying the ACs into the issue body so "done" stays testable.
- Open the **"Messaging platform"** milestone now and file 9.1 (and 9.2, if desired) there, including the original routing/WAHA/email/webhook notes that currently live in the local `.env` (they are moved out of the env file by §5.3).
- When an item's ACs change while working, update **this file** in the same PR (maintenance rule, §5.5) — this roadmap, not a parallel document, is the plan of record.
- Status of each item: track with the issue state (`todo` / `in progress` / `done`); do not edit checklists in this file per status update — the AC lists are the definition of done, not a progress bar.

---

## 11. Document history

| Version | Date | Change |
| --- | --- | --- |
| v1 | 2026-10-18 | [docs/v1/analysis.md](../v1/analysis.md) — first production-readiness audit (partially corrected by docs/v2/analysis.md §10) |
| v2 | 2026-10-19 | [docs/v2/analysis.md](../v2/analysis.md) verified audit + [docs/v2/roadmap.md](../v2/roadmap.md) P0–P3 plan (superseded by this document) |
| v3 | 2026-10-19 | [docs/v3/architecture.md](../v3/architecture.md) — as-is/target architecture reference (living document, updated per §5.5) |
| **v4** | **2026-10-19** | **This roadmap**: six phases by package (core → database → RLS → auth → api → project-wide), extensive ACs, out-of-scope list with reasons |

