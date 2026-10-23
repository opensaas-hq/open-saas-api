# Production Readiness Analysis — open-saas-api (v2)

> **Date:** 2026-10-19
> **Scope:** Full monorepo audit (`apps/api`, `packages/core`, `packages/auth`, `packages/database`) performed as a QA / Test Engineer / API Architect review.
> **Size:** ~1,732 LOC of TypeScript (including tests) across 4 workspaces.
> **Tooling status:** `typecheck`, `lint` (Biome) and `test` (44 tests) pass — but that is misleading: several of the critical defects below are invisible to the current test suite.
> **Methodology:** Every claim in this document was verified against the source at the stated `file:line` and, where relevant, against git history. Corrections against v1 are listed explicitly in [§10](#10-corrections-against-v1).

---

## Table of contents

1. [Critical bugs](#1-critical-bugs-the-api-does-not-actually-work)
2. [New findings (not in v1)](#2-new-findings-not-listed-in-v1)
3. [Architecture: what is wrong](#3-architecture-what-is-wrong)
4. [Missing design patterns](#4-missing-design-patterns)
5. [Dead and misplaced code](#5-dead-and-misplaced-code)
6. [Security checklist](#6-security-checklist)
7. [Testing gaps](#7-testing-gaps)
8. [CI/CD & operations](#8-cicd--operations)
9. [What is already good](#9-what-is-already-good)
10. [Corrections against v1](#10-corrections-against-v1)

---

## 1. Critical bugs (the API does not actually work)

### 1.1 Better Auth is never mounted

`packages/auth/src/auth.ts:7` creates the `betterAuth(...)` instance, but `apps/api/src/index.ts:35-36` only mounts `authRouter` (which contains a single `POST /register` route) and `contactsRouter`. The line

```ts
app.all("/api/auth/*", (c) => auth.handler(c.req.raw))
```

does not exist anywhere in the codebase.

**Impact:** No `sign-in`, `sign-up`, `sign-out`, `get-session`, no organization endpoints, no session issuance. Consequently `auth.api.getSession()` in `apps/api/src/middleware/tenant.ts:7` always returns `null` over HTTP, so **every route under `/api/contacts*` returns 401 forever**. Multi-tenant isolation has only ever been exercised at the repository level, never through the HTTP stack with a real session.

### 1.2 `POST /api/auth/register` persists nothing

`apps/api/src/routes/auth.ts:38-73` validates the email, evaluates the registration policy, and returns `201 "Registration successful"` — but it never inserts a user, never calls better-auth's `signUp`, never stores the waitlist status, and discards the `password` field it accepted. The endpoint is an empty facade.

The test `apps/api/src/__tests__/auth-registration.test.ts` asserts the 201 response, cementing the illusion that registration works.

### 1.3 `paid_required` mode trusts the client

`apps/api/src/routes/auth.ts:16` accepts `hasPaid: z.boolean().optional()` from the request body and `:56` passes it straight into the policy. A client can set `hasPaid: true` and bypass payment entirely. Payment verification must be server-side (checkout session / webhook confirmation).

### 1.4 `invite_code` mode never validates the code

`packages/auth/src/registration-policy.ts:34-45` only checks that the code is non-empty. The comment in the source admits it: *"Here you would typically validate the code against database repository"*. Any string passes.

### 1.5 Multi-tenant write isolation is broken

- `apps/api/src/middleware/tenant.ts:31-32` accepts `x-branch-id` (header or `branchId` query param) **without verifying that the branch belongs to the caller's organization**. `POST /api/contacts` will happily write a contact that belongs to your org but points at another org's branch — cross-tenant corruption.
- The middleware never verifies that the authenticated `user` is actually a **member** of `session.activeOrganizationId`. The `member` table exists in the schema and is never queried by anyone → tenant escalation is possible if a session ever carries an arbitrary `activeOrganizationId`.
- There is **no RBAC**: the `owner/admin/member` roles exist in `packages/database/src/schema.ts:128` and are never read or enforced.

### 1.6 CI is broken — the schema is never pushed

In `.github/workflows/ci.yml:47-50` the `run:` key is nested inside the `env:` block of the "Run Database Push" step:

```yaml
env:
  DATABASE_URL: postgresql://...
  run: bun --filter @opensaas/database db:push   # parsed as an env var, not a command
```

The step executes nothing. Combined with the absence of committed migrations (§8), CI runs the test suite against an empty schema and only survives because the tests that touch the DB are trivial or mocked.

### 1.7 `zod` is not declared where it is used

`zod` is imported by `packages/core/src/config.ts`, `apps/api/src/routes/auth.ts` and `apps/api/src/routes/contacts.ts`, but it exists only in the **root `devDependencies`** (`package.json:26`). It works today because Bun hoists aggressively; it breaks under partial installs, npm/pnpm, or any production install that prunes devDependencies. Additionally, `@opensaas/core` ships `zod`-validated config as a **runtime** feature while listing it as nothing at all.

### 1.8 Peer-dependency conflict: drizzle-orm vs better-auth

`better-auth@1.7.10` (resolved in `packages/auth/node_modules`) declares the **optional** peer `drizzle-orm: "^0.45.2 || >=1.0.0-rc.1 <2.0.0"`. The project declares `drizzle-orm: "^0.36.0"` (`packages/database/package.json`), which `bun.lock` resolves to `0.36.4` — outside better-auth's `^0.45.2` range. Bun suppresses optional-peer warnings, so nothing surfaces.

**Nuance:** because the peer is optional, this is not an install-time failure — but the Drizzle adapter is the persistence layer for every auth table, and a major-version skew between adapter and ORM is a classic source of subtle breakage (column mapping, transaction semantics). Treat as a high-priority compatibility risk, not a hard error.

### 1.9 Database test setup is dead code with a bug

`packages/database/src/__tests__/setup.ts` is imported by **no test file**, and its `TRUNCATE` statement targets a table named `"branch"` while the real table is `"branches"` (`packages/database/src/schema.ts:157`). Even if it were imported, the empty `catch {}` would swallow the failure silently, giving a false sense of isolation.

### 1.10 The health check lies and can hang

- `packages/database/src/health.ts:6-8` returns `true` unconditionally when `NODE_ENV === "test"`, so `/api/health` can report a healthy database that is down.
- The endpoint (`apps/api/src/index.ts:12-33`) performs the DB roundtrip **with no timeout**, so an unresponsive DB makes the health check itself hang instead of returning 503 — the opposite of what a health endpoint is for.

### 1.11 Internal errors are masked as 400

The local `catch` in `apps/api/src/routes/auth.ts:74-91` defaults `statusCode` to `400` for any thrown error. A genuine internal failure (DB down, NPE) is reported to clients and monitoring as a client error. The catch also **duplicates** the global `app.onError` handler (`index.ts:38-73`) with different semantics.

---

## 2. New findings (not listed in v1)

### 2.1 `GET /api/contacts` returns 500 on invalid query params

`apps/api/src/routes/contacts.ts:37` calls `contactsQuerySchema.parse(c.req.query())` without `safeParse`. A malformed query (`?limit=abc`, `?page=-1`) throws a raw `ZodError`, which falls through to `app.onError` as an unhandled error → `500 INTERNAL_SERVER_ERROR` instead of `422 VALIDATION_ERROR`. Three different validation strategies now coexist in the codebase (zValidator callback, `safeParse` + `ValidationError`, raw `parse`), and the raw one is the one users will hit by accident.

### 2.2 Tests write to the developer's real database

Bun auto-loads `.env`, which points `DATABASE_URL` at the local development database. `apps/api/src/__tests__/tenant-isolation.test.ts` inserts real organizations and contacts and **never cleans up**. The `pre-commit` hook (`.husky/pre-commit` → `bun test`) therefore mutates the developer's dev data on every commit, and repeated runs accumulate garbage rows. Tests are not side-effect-free.

The same coupling appears in `.release-it.json`, whose `before:init` hook runs `bun test` — cutting a release requires a live local database.

### 2.3 The CRUD surface is incomplete

`/api/contacts` exposes only `GET /`, `POST /` and `POST /bulk`. There is no `GET /:id`, no `PATCH`, no `DELETE`. Additionally, the `branches` table (`schema.ts:157-166`) has **no routes and no repository functions** — `createOrganization` is the only function under `repositories/`. Either the API surface or the schema is ahead of the other; that gap should be made explicit.

### 2.4 `.env.test` declares `NODE_ENV="development"`

The test environment file sets `NODE_ENV="development"`. Any code that branches on the environment (the health-check mock, logger transport, future feature flags) behaves in "test" runs exactly as it does in development — which is how the mock in §1.10 and any future `NODE_ENV` gate can diverge between local and CI.

### 2.5 Schema type inconsistencies

- `organization.metadata` is `text` (`schema.ts:111`) while `contacts.metadata` is `jsonb` (`schema.ts:184`).
- `contacts.status` is free-form `text` with a default — no Postgres enum, no CHECK constraint; anything can be stored at the DB layer.
- `updatedAt` columns exist on every table but nothing ever updates them: Drizzle's `$onUpdateFn` / `$onUpdate` is not configured, so `updatedAt` is effectively a second `createdAt`.

### 2.6 better-auth's built-in protections are not configured

The better-auth instance (`packages/auth/src/auth.ts`) enables `emailAndPassword` and installs the `organization` and `bearer` plugins, but leaves unused what the library already provides: built-in **rate limiting** (disabled by default), **`trustedOrigins`** for CSRF/origin checks, and `databaseHooks` — which is precisely the missing piece for wiring the session telemetry (§5.6). Before building custom rate limiting, turn on what the framework ships.

### 2.7 No separation between unit and integration tests

A single `bun test` invocation runs pure unit tests and real-database integration tests together. There is no `test:unit` / `test:integration` split, so contributors and CI cannot choose the cheap path, and a down database turns the entire suite red.

### 2.8 Hand-maintained context types will drift

`apps/api/src/types.ts:12-21` re-declares `user` and `session` shapes by hand. better-auth's `getSession` return type is the source of truth; the copies will drift silently as soon as the auth config changes (e.g. adding fields via plugins). Derive these with `InferSelectModel` / better-auth's exported types instead.

### 2.9 `zod`'s `.url()` accepts any scheme for `DATABASE_URL`

`packages/core/src/config.ts:11-14` validates `DATABASE_URL` with `z.string().url()`. A typo like `postgresl://...` or `http://...` passes validation and fails much later at connect time with a worse message. Use a regex/`startsWith("postgres")` refinement.

### 2.10 Import-time side effects make the packages unusable without full env

Importing `@opensaas/core` runs `parseEnv()` at module load and calls `process.exit(1)` on failure (`config.ts:33`); importing `@opensaas/database` throws if `DATABASE_URL` is missing (`client.ts:7-9`). Any script, migration, CLI or test that imports anything from these packages needs the full production environment before the import resolves. This also means the `logger` module — which reads raw `process.env` *before* validation (§3.3) — can log with an unvalidated level.

---

## 3. Architecture: what is wrong

### 3.1 No service / use-case layer

The flow is `route → repository` directly. Business logic (registration policy, email normalization, tenant composition) lives in HTTP handlers. The correct layering is `routes (HTTP/DTO) → services (business rules) → repositories (persistence)`.

### 3.2 Inconsistent repository conventions

`packages/database/src/contacts.ts` exports loose functions from the package root, while `packages/database/src/repositories/organization.ts` follows a `repositories/` convention. Two conventions for the same concept inside one package.

### 3.3 Config with two sources of truth

A Zod-validated `env` singleton exists (`packages/core/src/config.ts`), but raw `process.env` is read directly in:

- `packages/core/src/logger.ts:3,6` (`NODE_ENV`, `LOG_LEVEL` — and **before** validation has run)
- `packages/database/src/client.ts:5` (`DATABASE_URL`)
- `packages/auth/src/email-policy.ts:18` (`DISPOSABLE_EMAIL_DOMAINS`)
- `apps/api/src/routes/auth.ts:46` (`REGISTRATION_MODE`, which is **not even present in `envSchema`**)
- `packages/database/src/health.ts:6` (`NODE_ENV`)

Defaults diverge silently and `REGISTRATION_MODE` is unvalidated configuration on the most security-sensitive endpoint.

### 3.4 Import-time singletons without dependency injection

`db`, `env`, `logger` and `auth` are all constructed at module import. Consequences: impossible to substitute fakes in tests, impossible to close connections (graceful shutdown), hidden coupling. `apps/api/src/types.ts` even declares `env` and `db` in `AppVariables` — a prepared DI slot that is **never set anywhere** (dead code that documents the intended design but not the actual one).

### 3.5 No unified response handling

The `{success, error}` envelope is assembled in three different places with three different behaviors:

1. `app.onError` (`apps/api/src/index.ts:38-73`)
2. the `zValidator` failure callback (`apps/api/src/routes/auth.ts:23-37`)
3. the local `catch` in `apps/api/src/routes/auth.ts:74-91`

Handlers also hand-roll `c.json({success: true, data})`. There is no `app.notFound()`, so an unknown route returns Hono's plain-text 404, breaking the JSON contract of the API.

### 3.6 Missing cross-cutting security

No CORS configuration, no security headers (`secureHeaders()` from Hono), no rate limiting (login/registration/brute-force), no body-size limits, no request-id/correlation-id, and no request logging (only errors are logged).

### 3.7 No defense in depth in the database

- No index on `contacts(organizationId, status)` or `contacts(organizationId, branchId)` — the tenant filter is a sequential scan per request.
- No Postgres RLS.
- No unique constraints where they belong (e.g. contact email per organization).
- `updatedAt` never maintained (§2.5).
- No audit log of who wrote what, into which tenant.

Tenant scoping exists **only** as a `WHERE` clause in application code — one forgotten `where` and you leak another tenant's data. The DB itself offers no second line of defense.

### 3.8 Multi-tenancy is incomplete (summary)

Membership is never verified, branch ownership is never verified, and nothing at the repository layer prevents `createContact({ organizationId })` from being called with any organization — the only scoping lives in the route handler.

### 3.9 Monorepo is not standardized

- `packages/auth` and `packages/database` have **no `tsconfig.json`**, so their `tsc --noEmit` climbs to the root config and typechecks the entire repo (3× redundant work).
- `packages/core` enables `noUncheckedIndexedAccess` and friends; the other workspaces do not → unequal strictness.
- No `exports` maps, no TypeScript project references.
- `bun-types` (deprecated in favor of `@types/bun`) is mixed with `@types/bun` in the root `devDependencies`; the root/app tsconfigs use `"types": ["bun-types"]` while `packages/core/tsconfig.json` uses `"types": ["bun"]`.
- No `engines` / `packageManager` field pinning the runtime.

---

## 4. Missing design patterns

| Pattern | Status | Where it applies |
|---|---|---|
| Layered architecture (route → service → repo) | ❌ missing | entire API |
| Consistent repository convention | ⚠️ partial | `contacts.ts` outside `repositories/` |
| Strategy + registry for `RegistrationMode` | ❌ rigid `switch` | `registration-policy.ts` — adding a mode requires editing the switch |
| Factory for `db` / client | ❌ raw singleton | `packages/database/src/client.ts` |
| Middleware pipeline (auth → tenant → RBAC → rate-limit → validation) | ⚠️ auth + tenant only | `apps/api` |
| Response envelope / result helper | ⚠️ type exists, unused | 3 duplicated implementations |
| DTO + mapper layer | ❌ | Zod schemas mixed with domain types |
| Unit of Work / explicit transactions | ⚠️ `withTransaction` exists, unused | bulk create, multi-table flows |
| Correlation context (AsyncLocalStorage) | ❌ | logging + tracing |
| Health checks: separate liveness/readiness | ⚠️ single endpoint | `index.ts:12` |
| Idempotency keys | ❌ | all write POSTs |
| Graceful shutdown | ❌ | `client.end()` is never called |
| Circuit breaker / retry / pool tuning | ❌ | `client.ts` — no pool config, no timeouts |
| Outbox / event bus | ❌ | future messaging phases (WA/email) |

---

## 5. Dead and misplaced code

1. **`packages/database/src/__tests__/setup.ts`** — never imported, wrong table name (`branch` vs `branches`), empty `catch`. Delete it or fix and wire it in.
2. **`packages/database/src/health.ts`** — a test mock inside the data layer; "is it healthy?" belongs to the app, and the mock belongs in the test suite.
3. **`packages/database/src/contacts.ts`** — move to `repositories/contact.ts`, aligned with `organization.ts`.
4. **`.env` (gitignored, local)** — contains a multi-phase product roadmap (routing engines, WAHA, email providers, webhooks — phases 3–6) written as free-form comments. Roadmap content belongs in issues/project docs, not in an env file, even a local one. **Note:** this was misattributed to `.env.test` in v1; see [§10](#10-corrections-against-v1).
5. **`.env.test`** — contains a local credential (`admin:omarchy`) and, as noted in §2.4, declares `NODE_ENV="development"`. The file is properly gitignored (it has never been committed — verified via `git log --all`), but the credential should be rotated if this machine is shared, and the env value fixed.
6. **`apps/api/src/types.ts`** — `env` and `db` in `AppVariables` are never set → dead DI scaffolding (either inject for real or delete).
7. **`apps/api/src/middleware/tenant.ts:1`** — imports `extractTelemetryFromHeaders` and never uses it. Consequently `packages/auth/src/telemetry.ts` (68 lines, with its own tests) and the **9 telemetry columns** on the `session` table (`browser`, `os`, `deviceType`, `language`, `timezone`, `country`, `city`, `ipAddress`, `userAgent`) are completely dead. Either wire them through better-auth's `databaseHooks.beforeCreateSession`, or delete code and columns.
8. **`apps/api/src/index.ts:1`** — `ApiResponse` imported and unused.
9. **Inconsistent test placement** — `core/errors.test.ts` and `database/schema.test.ts` are colocated in `src/`, everything else lives in `__tests__/`. Pick one convention.
10. **Biome version drift** — `biome.json` declares schema `1.8.3` while `1.9.4` is installed.
11. **`.env.example`** — does not document `REGISTRATION_MODE` (which is itself missing from `envSchema`).

---

## 6. Security checklist

- ❌ Rate limiting / account lockout on auth endpoints (and better-auth's built-in limiter left disabled — §2.6)
- ❌ CORS and security headers (`secureHeaders()`)
- ❌ Body-size limits; `POST /bulk` has **no `max`** on the array (a single request can insert millions of rows); `metadata: z.record(z.any())` has no depth/size limit
- ❌ `ilike` patterns built from user input without escaping `%`/`_` (`packages/database/src/contacts.ts:41`) — wildcard injection in search
- ❌ No email verification, no password reset, no session rotation
- ❌ No audit log of writes per tenant
- ❌ No `SECURITY.md` / vulnerability disclosure policy
- ❌ Hardcoded secret in CI (`.github/workflows/ci.yml:55` — `ci_secret_key_...`) → move to GitHub Secrets
- ⚠️ Credentials (`admin:omarchy`) exist in local `.env` / `.env.test`; both files are gitignored and the git history is clean — rotate, don't panic
- ❌ `hasPaid` and `inviteCode` trusted from the client (§1.3, §1.4)
- ❌ `x-branch-id` accepted without tenant ownership verification (§1.5)

---

## 7. Testing gaps

- 44 tests pass, but a large share are trivial (`expect(fn).toBeDefined()`-style smoke assertions).
- **Zero HTTP tests with an authenticated session** — the tenant middleware has never been exercised for real (and cannot be: there is no sign-in, §1.1).
- No coverage reporting, no coverage gate in CI.
- No fixtures/factories; integration tests build ad-hoc data and never clean up (§2.2).
- No test asserts that `/register` persists a user — because it does not (§1.2).
- No negative tests for cross-tenant access (branch from another org, non-member session).
- `pre-commit` runs the full suite against the local database — fragile for contributors and destructive for the dev DB (§2.2).
- Tests mutate `process.env.REGISTRATION_MODE` between cases without a global reset strategy — order-dependent by construction.

---

## 8. CI/CD & operations

- **CI is broken** (§1.6). Beyond that:
  - No cache for Bun installs
  - `bun-version: latest` — not reproducible
  - No `concurrency` group (duplicate runs on stacked PRs)
  - Hardcoded secret (§6)
  - No security job (dependency audit, CodeQL / Semgrep, zizmor for workflows)
  - No Dependabot / Renovate
  - No coverage upload or gate
- **No CD**, no Dockerfile, no docker-compose for local dev onboarding.
- **No migrations**: the `drizzle/` output directory does not exist and is even gitignored (`.gitignore` ignores `drizzle/*.sql.json` and `.drizzle/`). Production must never be provisioned with `db:push`; committed, reviewed SQL migrations are required.
- No graceful shutdown, no signal handling — in-flight requests die on deploy, connections are never drained.
- No metrics, no distributed tracing, no structured request logs (pino is configured but only invoked for errors and startup).
- `README.md` is a single line; no architecture docs, no ADRs, no CONTRIBUTING, no CODEOWNERS, no SECURITY, no CODE_OF_CONDUCT.
- Release process (`release-it`) is configured but its `before:init` hook requires a live local database (§2.2).

---

## 9. What is already good

- `AppError` hierarchy with stable error codes (`packages/core/src/errors.ts`)
- The `{success, data | error}` response contract (typed in `ApiResponse`)
- Zod validation at the HTTP boundary (where it is used consistently)
- Tenant middleware as a *concept* — the right place to enforce isolation
- Bun workspaces monorepo with a committed `bun.lock` and `--frozen-lockfile` in CI
- Tooling: Biome, commitlint (conventional commits), husky, release-it with conventional changelog
- `withTransaction` helper ready in `packages/database/src/client.ts`
- Email normalization + disposable-domain policy with real unit tests
- Drizzle schema fully typed; better-auth adapter pattern correctly chosen
- MIT LICENSE, issue templates (bug/feature) and a PR template already in place
- Registration-mode strategy concept (`public` / `waiting_list` / `invite_code` / `paid_required`) — the right abstraction, currently under-implemented

---

## 10. Corrections against v1

The v1 document (`docs/analysis.md`) was reviewed claim-by-claim against the source and git history. The following statements in v1 are **incorrect or imprecise** and have been fixed here:

| v1 claim | Verified reality |
|---|---|
| §4.4 / §5: `.env.test` contains roadmap notes and **committed** credentials (`admin:omarchy`) | False on both counts. Roadmap notes live in **`.env`** (gitignored), not `.env.test`. `.env.test` contains the credential but **has never been committed** (`git log --all -- .env.test` is empty; only `.env.example` is tracked). The real (smaller) issue: roadmap notes in an env file, and a rotatable local credential. |
| §1.8: "peer dependency conflict — a compatibility bomb" | Correct concern, imprecise severity: `drizzle-orm` is an **optional** peer of better-auth. Real adapter risk, not an install failure. Nuanced in §1.8. |
| Scope: "~2100 LOC" | Actual TypeScript total is **~1,732 LOC** including tests. |
| §1.1: "`getSession()` always returns `null` → permanent 401" | Directionally correct; the precise cause is that **no HTTP path exists to create a session** (the handler is never mounted), not a defect inside `getSession` itself. |

Everything else in v1 (bugs §1.1–1.11, architecture §2.x/3.x, security, CI breakage, dead code) was **verified as accurate** and is preserved — expanded and renumbered — in this document.
