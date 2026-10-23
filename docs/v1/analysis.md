# Production Readiness Analysis — open-saas-api

> **Date:** 2026-10-18
> **Scope:** full monorepo analysis (~2100 LOC: `apps/api`, `packages/core`, `packages/auth`, `packages/database`).
> **Tooling status:** `typecheck`, `lint` (Biome) and `test` (44 tests) all pass — but that is misleading: several critical problems are not covered by the tests.

---

## 1. Critical bugs (the API does not actually work)

### 1.1 Better Auth is never mounted
`packages/auth/src/auth.ts` creates the `betterAuth(...)` instance, but `apps/api/src/index.ts` **has no** `app.all("/api/auth/*", (c) => auth.handler(c.req.raw))`. Only `authRouter` is mounted, and it has a single endpoint: `/register`.

Consequence: there is no `sign-in`, `sign-out`, `sign-up`, `get-session`, or organization creation. **Nobody can ever authenticate**, and `auth.api.getSession()` in `middleware/tenant.ts:7` always returns `null` → **every `/api/contacts*` route permanently returns 401**. Multi-tenancy isolation is only tested against the repository layer, never over HTTP.

### 1.2 `/api/auth/register` persists nothing
`apps/api/src/routes/auth.ts` validates the email and the registration policy, then returns `"Registration successful"` — but it never inserts a user, never calls better-auth, and never stores the waitlist status. It accepts `password` and discards it. The endpoint is an empty facade.

### 1.3 `paid_required` trusts the client
`routes/auth.ts:16,56` — the client sends `hasPaid: true` and gets registered. Complete payment bypass.

### 1.4 `invite_code` never validates the code
`packages/auth/src/registration-policy.ts:44` only checks that it is not empty (the comment says *"Here you would typically validate..."*). Any string passes.

### 1.5 Multi-tenant isolation broken on writes
- `middleware/tenant.ts:31` accepts `x-branch-id` from anywhere **without checking that the branch belongs to the organization** → `POST /api/contacts` can create a contact for your org pointing at another org's branch (cross-tenant data corruption).
- Nothing verifies that the `user` is a **member** of `activeOrganizationId` (the `member` table exists and nobody queries it) → tenant escalation.
- No RBAC: the `owner`/`admin`/`member` roles exist in the schema and are never used.

### 1.6 CI is broken
In `.github/workflows/ci.yml:47-50`, the `run:` key is nested inside `env:` — the "Run Database Push" step **executes nothing** (it becomes an environment variable). The schema is never pushed in CI.

```yaml
env:
  DATABASE_URL: ...
  run: bun --filter @opensaas/database db:push   # ← this is an ENV, not a command
```

### 1.7 `zod` is not declared where it is used
It is imported by `packages/core/src/config.ts` and `apps/api/src/routes/*`, but it only exists in the root `devDependencies`. This works through Bun's hoisting; it breaks on partial/production installs.

### 1.8 Peer dependency conflict
`better-auth@1.7.10` requires `drizzle-orm ^0.45.2`; the project uses `^0.36.0`. Bun silences this; it is a compatibility time bomb (the adapter may fail subtly).

### 1.9 Database tests have no isolation
`packages/database/src/__tests__/setup.ts` is **never imported** (dead file), and it truncates the table `"branch"` while the real table is `"branches"` — even if it were imported, it would fail silently because of the empty `catch {}`.

### 1.10 A health check that lies
`packages/database/src/health.ts:6` returns a mocked `true` when `NODE_ENV=test`. In addition, the health endpoint (`apps/api/src/index.ts:12`) performs a DB roundtrip **without a timeout** (it can hang).

### 1.11 Internal errors masked as 400
`routes/auth.ts:74-91` catches everything and returns `400 REGISTRATION_FAILED` → a real internal error (500) is reported as 400, masking failures in monitoring. It also duplicates the global `onError` handler.

---

## 2. Architecture: what is wrong

### 2.1 No service / use-case layer
The flow is `route → repository` directly. Business logic (registration, policies, tenant composition) lives in the handlers. Correct missing pattern: `routes (HTTP/DTO) → services (business rules) → repositories (persistence)`.

### 2.2 Inconsistent repositories
`database/src/contacts.ts` (loose functions at the root) vs `database/src/repositories/organization.ts` (a `repositories/` folder). Two conventions for the same thing in the same package.

### 2.3 Config with two sources of truth
A Zod-validated `env` singleton exists, but `process.env` is read raw in:
- `core/src/logger.ts:3,6`
- `database/src/client.ts:5`
- `auth/src/email-policy.ts:18`
- `routes/auth.ts:46` (`REGISTRATION_MODE`, which is **not even in `envSchema`**)
- `database/src/health.ts:6`

Defaults can silently diverge.

### 2.4 Import-time singletons without DI
`db`, `env`, `logger` and `auth` are constructed at module import. Testing with fakes is impossible, connections cannot be closed, coupling is direct. Missing: factories + injection (even just via Hono's context, already sketched in `types.ts` — where `env` and `db` are declared but **never assigned**: dead code).

### 2.5 No unified response handling
Three different ways to build `{success, error}`:
1. In `app.onError` (`index.ts:38`)
2. In the `zValidator` callback (`routes/auth.ts:23`)
3. In the local `catch` of `routes/auth.ts:74`

Handlers build `c.json({success:true, data})` by hand. Missing: a single envelope helper + `app.notFound()` (today a 404 returns Hono's plain text, breaking the API contract).

### 2.6 Cross-cutting security absent
No CORS, no security headers, no rate limiting (login/registration/brute-force), no body size limit, no request-id/correlation-id, no request logging (errors only).

### 2.7 No defense in depth in the database
- No indexes on `contacts(organizationId, status)`
- No Postgres RLS
- No unique constraints (e.g. email per org)
- No automatic `updated_at`
- No audit log

Tenant scoping exists only at query level — one forgotten `where` and you leak other tenants' data.

### 2.8 Incomplete multi-tenancy
No membership validation, no branch-ownership verification, and nothing prevents `createContact` from receiving any `organizationId` from the repository layer (validation lives only in the route).

### 2.9 Monorepo not standardized
- `packages/auth` and `packages/database` **have no `tsconfig.json`** → their `tsc --noEmit` walks up to the root and typechecks the whole repo 3 times.
- `packages/core` has strict flags (`noUncheckedIndexedAccess`) and the others do not: uneven strictness.
- No `exports` map in the `package.json` files, no project references.
- Deprecated `bun-types` mixed with `@types/bun`.

---

## 3. Missing design patterns

| Pattern | Status | Where it applies |
|---|---|---|
| **Layered architecture** (route→service→repo) | ❌ missing | the whole API |
| **Consistent repository** | ⚠️ partial | `contacts.ts` outside the pattern |
| **Strategy + Registry** for `RegistrationMode` | ❌ a rigid `switch` | `registration-policy.ts` (adding modes requires editing the switch) |
| **Factory** for `db`/`client` | ❌ raw singleton | `database/src/client.ts` |
| **Middleware pipeline** auth→tenant→RBAC→rate-limit→validation | ⚠️ only auth+tenant | `apps/api` |
| **Response envelope / Result builder** | ⚠️ type exists, unused | 3 duplicated implementations |
| **DTO + Mapper layer** | ❌ | Zod schema mixed with domain types |
| **Unit of Work / explicit transactions** | ⚠️ `withTransaction` exists, nobody uses it | bulk create, multi-table flows |
| **Correlation/Context (AsyncLocalStorage)** | ❌ | logging + tracing |
| **Separated health checks** liveness/readiness | ⚠️ single endpoint | `index.ts:12` |
| **Idempotency keys** | ❌ | write POSTs |
| **Graceful shutdown** | ❌ | `client.end()` is never called |
| **Circuit breaker / retry** for the DB | ❌ | `client.ts` has no pool config or timeouts |
| **Outbox / event bus** | ❌ | future (planned WA/email messaging) |

**What is good and should be kept:**
- `AppError` hierarchy with error codes
- `{success, data|error}` contract
- Zod validation at the boundaries
- Tenant middleware as a concept
- Workspaces monorepo
- Tooling: Biome + commitlint + release-it

---

## 4. Redundant / misplaced files

1. **`packages/database/src/__tests__/setup.ts`** — dead (never imported) + table bug (`branch` vs `branches`). Remove it or fix and import it.
2. **`packages/database/src/health.ts`** — test mock inside the data layer; "is it healthy?" belongs to the app, not the repository, and the mock belongs in the test.
3. **`packages/database/src/contacts.ts`** — move to `repositories/contact.ts` (aligned with `organization.ts`).
4. **`.env.test`** — contains personal roadmap notes ("fase 2.5, fase 3, omniroute routing") and committed credentials (`admin:omarchy`). Ideas belong in an issue/TODO, not in an env file.
5. **`apps/api/src/types.ts`** — `env` and `db` in `AppVariables` are never assigned → dead (inject them or delete them).
6. **`middleware/tenant.ts:1`** — imports `extractTelemetryFromHeaders` and never uses it. Consequently `packages/auth/src/telemetry.ts` (68 lines) and the **9 telemetry columns** of the `session` table (browser, os, country, city…) are **entirely dead** — either wire them up via better-auth's `databaseHooks.beforeCreateSession`, or delete the code and the columns.
7. **`index.ts:1`** — `type ApiResponse` imported and unused.
8. **Inconsistent test locations:** `core/errors.test.ts` and `database/schema.test.ts` are colocated in `src/`, the rest live in `__tests__/`. A single convention is needed.
9. **Biome:** schema declared as `1.8.3` but `1.9.4` installed (mismatch).
10. **`.env.example`** does not document `REGISTRATION_MODE` (which is not in `envSchema` either).

---

## 5. Security (production checklist)

- ❌ Rate limiting / lockout on auth
- ❌ CORS and security headers (Hono's `secureHeaders()`)
- ❌ Body size limit; bulk endpoint with no `max` on the array (millions of rows); `metadata: z.record(z.any())` with no depth/size limit
- ❌ `ilike` with unescaped `%`/`_` in `database/src/contacts.ts:41` (wildcard injection)
- ❌ No email verification, no password reset, no session rotation
- ❌ No audit log of who wrote which tenant's data
- ❌ No `SECURITY.md` / disclosure policy
- ⚠️ `.env` is fine (gitignored, never in history), but `.env.test` **is** committed with credentials
- ❌ Hardcoded CI secret (`ci_secret_key_...`) → use GitHub Secrets

---

## 6. Testing

- 44 tests pass, but many are trivial (`expect(fn).toBeDefined()`)
- **Zero HTTP tests with an authenticated session** — the tenant middleware is never really exercised (and it would fail: there is no sign-in)
- No coverage report or coverage gate in CI
- No fixtures/factories
- No test for `/register` persisting users (because it does not persist)
- `pre-commit` runs `bun test` against the local DB — fragile for contributors

---

## 7. CI/CD & Ops

- **CI broken** (see §1.6); additionally:
  - No install caching
  - `bun-version: latest` (not reproducible)
  - No `concurrency` group
  - Hardcoded secret
  - No security job (audit/CodeQL)
  - No dependabot
- No **CD**, no **Dockerfile**, no docker-compose for development
- No graceful shutdown or signal handling
- No metrics/tracing (OpenTelemetry), no structured request logs
- **1-line** README; no architecture docs, no ADRs, no CONTRIBUTING/CODEOWNERS/SECURITY

---

## 8. Proposed roadmap (by priority)

### P0 — Make it work and stop leaking data (Weeks 1-2)

1. Mount `auth.handler` on `/api/auth/*` + a real registration endpoint (better-auth `signUp`, or a proper hashing strategy) + organization creation
2. Verify membership + branch ownership in the middleware; validate `branchId` against the organization
3. Fix CI (the `db:push` step), add committed Drizzle migrations (stop using `push` in production)
4. Declare `zod` where it is used; align `drizzle-orm` with better-auth; add `REGISTRATION_MODE` to `envSchema` and remove all raw `process.env` reads
5. Implement real invite-code validation and server-side payment verification

### P1 — Robustness and standards (Weeks 3-4)

6. Service layer + uniform repositories + DTOs; single response helper + `app.notFound` + centralized error handler
7. Middleware pipeline: CORS, secureHeaders, rate-limit, request-id + request logging, body limits
8. RBAC (owner/admin/member), DB indexes, unique constraints, audit log, transactions where appropriate
9. Per-package tsconfig with `extends` + uniform strictness, `exports` maps, pinned engines/bun-version
10. Tests: real DB setup (fix TRUNCATE), authenticated end-to-end tests, coverage gate

### P2 — Scalability and ops (Weeks 5-6)

11. Dockerfile + CD, separate liveness/readiness healthchecks, graceful shutdown, tuned connection pool
12. OpenAPI/Zod-to-OpenAPI, `/api/v1` versioning, caching/ETags, idempotency keys
13. Observability: metrics, tracing, dashboards; SECURITY.md, CONTRIBUTING, docs/ADR
14. Resolve dead code: telemetry (wire up or remove), unused types, redundant files
