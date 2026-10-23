# Roadmap — open-saas-api

> **Date:** 2026-10-19
> **Companion document:** [analysis.md](./analysis.md) — every item below references a verified finding (§) there.
> **Goal:** take the project from "demo-shaped" to a robust, modular, scalable, secure, well-documented open-source API.

**Priority legend**

| Phase | Meaning | Target |
|---|---|---|
| **P0** | The API does not work / leaks data. Nothing else matters until this is done. | Weeks 1–2 |
| **P1** | Robustness and standards: layered architecture, middleware pipeline, real tests. | Weeks 3–4 |
| **P2** | Scalability and operations: containers, migrations discipline, observability, versioning. | Weeks 5–6 |
| **P3** | Open-source quality: docs, community files, release engineering. | Weeks 7–8 |

Each item lists **acceptance criteria** (AC) so "done" is testable, not subjective.

---

## P0 — Make it work and stop the bleeding (weeks 1–2)

### 0.1 Mount Better Auth for real
Wire `app.all("/api/auth/*", (c) => auth.handler(c.req.raw))` in `apps/api/src/index.ts` **before** any custom `/api/auth/*` routes, and delete the fake surface if superseded. *(analysis §1.1)*

- **AC1:** `POST /api/auth/sign-up/email`, `sign-in/email`, `sign-out`, `GET /api/auth/get-session` respond correctly over HTTP.
- **AC2:** An HTTP integration test obtains a real session cookie and uses it to call `GET /api/contacts` successfully (200, not 401).
- **AC3:** Organization endpoints from the better-auth `organization` plugin are reachable.

### 0.2 Real registration (or remove the endpoint)
Replace the facade in `apps/api/src/routes/auth.ts` with a flow that persists: call better-auth `signUp` (which creates `user` + `account`), create the organization + membership, and store waitlist status when applicable. *(analysis §1.2)*

- **AC1:** A `POST /register` request creates a `user` row and an `account` row with a hashed password; the raw password is never stored or logged.
- **AC2:** In `waiting_list` mode the user is created with a persisted waitlist status, not just a response message.
- **AC3:** Registering the same email twice yields a clean 409/422, not a 500.

### 0.3 Server-side trust for payment and invite codes
Remove `hasPaid` from the client schema. Verify payment via checkout-session lookup / webhook state. Validate `inviteCode` against the `invitation` table (or a dedicated codes table) with expiry and single-use semantics. *(analysis §1.3, §1.4)*

- **AC1:** No request field can assert payment; unverified requests get 403 `PAYMENT_REQUIRED`.
- **AC2:** An invalid/expired/used invite code is rejected; a valid one is consumed atomically.
- **AC3:** Unit tests cover each `RegistrationMode` end-to-end through the service layer.

### 0.4 Close the multi-tenant holes
In `tenantContextMiddleware`: (a) verify `user` is a member of `activeOrganizationId` (query the `member` table, cache per request); (b) if a `branchId` is supplied, verify it belongs to that organization; (c) enforce RBAC (owner/admin/member) with a dedicated middleware. *(analysis §1.5, §3.8)*

- **AC1:** A session whose `activeOrganizationId` the user does not belong to receives 403.
- **AC2:** `x-branch-id` pointing at another org's branch is rejected (404/403) on every route that accepts it.
- **AC3:** Negative integration tests exist for both cases.
- **AC4:** `member.role` drives at least one differentiated permission (e.g. only admin/owner may bulk-import).

### 0.5 Fix CI and introduce real migrations
Fix the nested `run:`/`env:` bug in `.github/workflows/ci.yml:47-50`. Generate and **commit** Drizzle migrations (`drizzle-kit generate`), stop gitignoring `drizzle/*.sql`, switch CI to `drizzle-kit migrate`, and add a Bun install cache + pinned `bun-version` + `concurrency` group. Move the hardcoded secret to GitHub Secrets. *(analysis §1.6, §8)*

- **AC1:** The CI "migrate" step runs a real command and fails loudly on error.
- **AC2:** `bun-version` is pinned (e.g. `1.4.x`); a broken migration fails the pipeline.
- **AC3:** No secrets in workflow files (`gitleaks`/trivy config optional but recommended).

### 0.6 Dependency and config hygiene
Declare `zod` (and anything else imported at runtime) in the workspaces that use it. Upgrade `drizzle-orm` to satisfy better-auth's peer range (or pin better-auth to a version compatible with 0.36 — prefer upgrading). Add `REGISTRATION_MODE` to `envSchema` with an enum + default, and purge every raw `process.env` read in favor of the validated `env` singleton. *(analysis §1.7, §1.8, §3.3)*

- **AC1:** Each package installs and typechecks in isolation (no reliance on hoisting).
- **AC2:** `grep -r "process.env" apps packages` returns hits only in `config.ts` (and tests).
- **AC3:** An invalid `REGISTRATION_MODE` fails fast at boot with a clear message.

### 0.7 Stop error masking and hanging health checks
Delete the local `catch` in the register route (let `app.onError` own it), and make `/api/health` honest: remove the `NODE_ENV === "test"` mock, add a timeout to the DB probe, and split liveness (`/healthz`, no DB) from readiness (`/readyz`, DB probe with timeout). *(analysis §1.10, §1.11)*

- **AC1:** An internal failure returns 500 `INTERNAL_SERVER_ERROR`, never 400.
- **AC2:** With the DB stopped, `/readyz` returns 503 within the timeout; `/healthz` still returns 200.

---

## P1 — Robustness and standards (weeks 3–4)

### 1.1 Layered architecture: services + uniform repositories
Introduce `apps/api/src/services/` (or per-package services) so routes become thin HTTP adapters. Move `packages/database/src/contacts.ts` into `repositories/contact.ts`. Make every repository follow the same signature convention (input DTO in, domain row out; tenant id is a **required** argument). *(analysis §3.1, §3.2, §4)*

- **AC1:** No route handler contains business branching beyond validation + orchestration.
- **AC2:** All repositories live under `repositories/` with consistent exports.
- **AC3:** `withTransaction` is used by every multi-row/multi-table flow (bulk create, registration).

### 1.2 Single response envelope + global 404
Add `respondOk` / `respondError` helpers (or a small result type), convert the three existing envelope implementations to use them, and register `app.notFound()` returning the JSON error contract. Add a `ZodError` → 422 branch in `onError` (fixes the `GET /api/contacts` 500 bug). *(analysis §2.1, §3.5)*

- **AC1:** An unknown route returns JSON `{"success":false,"error":{"code":"NOT_FOUND",...}}`.
- **AC2:** `?limit=abc` on list endpoints returns 422 with field details, never 500.
- **AC3:** Exactly one place in the codebase builds the error envelope.

### 1.3 Middleware pipeline: CORS, headers, rate limits, request-id, body limits
Order: `request-id → logger → secureHeaders → CORS → rate-limit → auth → tenant → RBAC → route validation`. Enable better-auth's built-in rate limiter for auth routes in the interim. Apply body-size limits globally and a `max` on the bulk array; cap `metadata` depth/size. Escape `%`/`_` in `ilike` search input. *(analysis §2.6, §3.6, §6, §2.6-better-auth)*

- **AC1:** Every response carries a `x-request-id` and security headers.
- **AC2:** Login/register return 429 with `Retry-After` after a defined threshold.
- **AC3:** A bulk payload over the max size is rejected with 413/422.
- **AC4:** Search strings containing `%`/`_` match literally.

### 1.4 Database defense in depth
Add indexes: `contacts(organizationId, status)`, `contacts(organizationId, branchId)`, `member(organizationId, userId)`. Add unique constraint for contact email per org (partial index where email is not null). Configure `$onUpdateFn` for `updatedAt`. Convert `contacts.status` to a pgEnum (or CHECK). Decide on `organization.metadata`: jsonb for consistency. Introduce an `audit_log` table (actor, tenant, action, entity, diff) written from service layer. *(analysis §2.5, §3.7)*

- **AC1:** `EXPLAIN` on the tenant-filtered list query uses an index.
- **AC2:** `updatedAt` changes on update without application code setting it.
- **AC3:** A duplicate contact email within the same org is rejected by the DB.
- **AC4:** Creating/deleting a contact writes an audit row with the acting user id.

### 1.5 Test suite that deserves the name
- Fix or delete `__tests__/setup.ts` (correct table names, imported where used, no empty catch). *(analysis §1.9)*
- Split `test:unit` (no DB) / `test:integration` (DB) scripts; integration tests run against a dedicated test database (`DATABASE_URL_TEST`), **never** the dev DB; truncate with cleanup after each suite. Remove `bun test` from `pre-commit` (keep it in CI); optionally offer an opt-in `pre-push`. *(analysis §2.2, §2.7)*
- Add authenticated HTTP tests for the full matrix: cross-tenant branch, non-member session, RBAC denials, each registration mode.
- Add factories/fixtures; kill order-dependent `process.env` mutation in tests (inject config instead).
- Wire coverage (`bun test --coverage`) with a gate in CI (start at current floor, ratchet up).

- **AC1:** `bun run test:unit` passes with no database running.
- **AC2:** `bun run test:integration` creates and tears down its own schema.
- **AC3:** Coverage of `apps/api/src` ≥ 80% lines; critical middleware 100%.
- **AC4:** No test file reads the developer's `.env` database.

### 1.6 Standardize the monorepo
Add `tsconfig.json` to `packages/auth` and `packages/database` (shared `tsconfig.base.json` + `extends`); enable the same strict flags everywhere (including `noUncheckedIndexedAccess`); replace `bun-types` with `@types/bun` consistently; add `exports` maps and TS project references; add `engines`/`packageManager`. Decide on test placement convention (colocated `*.test.ts` recommended) and move stragglers. *(analysis §3.9, §5.9)*

- **AC1:** `bun run typecheck` runs each workspace exactly once against its own config.
- **AC2:** `grep bun-types` returns nothing.
- **AC3:** Workspace packages resolve via `exports` maps.

### 1.7 Resolve the dead-code backlog
Telemetry: wire `extractTelemetryFromHeaders` through better-auth `databaseHooks.beforeCreateSession` **or** delete the module and drop the 9 session columns. Delete unused `AppVariables.env/db`, unused `ApiResponse` import, the health-check mock. Align `biome.json` schema version with installed Biome. Document `REGISTRATION_MODE` in `.env.example`. Move the roadmap notes out of `.env` into GitHub issues/milestones. *(analysis §5)*

- **AC1:** `knip` (or manual audit) reports no unused exports in `apps/` and `packages/`.
- **AC2:** `.env` contains only configuration.
- **AC3:** Every schema column is written by at least one code path (or removed).

---

## P2 — Scalability and operations (weeks 5–6)

### 2.1 Containerize and ship
Multi-stage `Dockerfile` (build with Bun, run minimal image), `docker-compose.yml` for local dev (Postgres + API + drizzle migrate on boot), healthcheck directives wired to `/healthz`. Add a deploy workflow (CD) triggered on tags. *(analysis §8)*

- **AC1:** `docker compose up` gives a working stack for a new contributor in one command.
- **AC2:** Container starts, becomes ready, and fails its healthcheck correctly when DB is down.
- **AC3:** Tag push produces a release artifact.

### 2.2 Graceful shutdown and connection discipline
Handle `SIGTERM`/`SIGINT`: stop accepting connections, wait for in-flight requests (drain timeout), then `client.end()`. Tune the `postgres` pool (max connections, idle timeout, statement timeout) via config. Add retry-with-backoff for transient DB errors on startup. *(analysis §4)*

- **AC1:** Rolling deploys produce zero 5xx from in-flight request loss.
- **AC2:** Pool settings are validated env/config, not hardcoded defaults.

### 2.3 API versioning and contract
Introduce `/api/v1` prefix. Generate OpenAPI from the Zod schemas (`@asteasolutions/zod-to-openapi` or zod-openapi) and publish `/api/v1/openapi.json` + a Swagger UI page. Add idempotency-key support for write endpoints (bulk import, registration). Add ETag/cache headers on list endpoints where safe. *(analysis §4)*

- **AC1:** `/api/v1/openapi.json` validates against the OpenAPI 3.1 spec and is generated in CI (drift check).
- **AC2:** Replaying a POST with the same `Idempotency-Key` does not duplicate data.
- **AC3:** A documented deprecation policy exists (README section).

### 2.4 Observability
Structured request logs (method, path, status, duration, request-id, tenant id — never bodies/PII). Prometheus-style `/metrics` (request duration histogram, DB pool stats, auth outcomes). OpenTelemetry tracing optional behind a flag. Alert-ready: readiness, error rate, p95 latency. *(analysis §3.6-correlation, §8)*

- **AC1:** One request produces exactly one structured access-log line.
- **AC2:** `/metrics` exposes request count/latency histograms scrapeable by Prometheus.
- **AC3:** Logs and traces share the request-id.

### 2.5 Security hardening pipeline in CI
Add: dependency audit (`bun audit` / npm audit gate), CodeQL or Semgrep for TS, zizmor for workflow linting, gitleaks for secret scanning, knip for dead code. Add `SECURITY.md` with a disclosure policy. Rotate the local `admin:omarchy` credential. *(analysis §6, §8, §10-v1-correction)*

- **AC1:** A PR introducing a known-vulnerable dependency fails CI.
- **AC2:** `SECURITY.md` exists with contact + scope.
- **AC3:** Secret scan runs on the full history.

### 2.6 Multi-tenancy at scale (prepare, don't overbuild)
Per-request membership cache (short TTL) to avoid a `member` query per request. Consider Postgres RLS as the second line of defense for `contacts` (app sets `SET LOCAL app.current_org` per transaction). Connection-per-tenant is out of scope; document the isolation model in `docs/architecture/multitenancy.md`. *(analysis §3.7, §3.8)*

- **AC1:** Membership check is cached with documented TTL and invalidation on role change.
- **AC2:** Architecture doc explains the isolation guarantees and their limits.
- **AC3:** (Optional/stretch) RLS enabled in a feature-flagged migration with tests proving cross-tenant reads fail even with a buggy query builder.

---

## P3 — Open-source quality (weeks 7–8)

### 3.1 Documentation set
- README rewrite: what it is, architecture diagram, quickstart (compose up), env reference, API examples with curl, badges (CI, license, coverage).
- `CONTRIBUTING.md`: setup, conventions (commits, PRs, branches), how to run tests without polluting data.
- `docs/architecture/` overview + ADRs for the decisions already made (Hono+Drizzle+Better-Auth, monorepo, envelope contract) and the ones this roadmap makes (service layer, migrations-not-push).
- `CODE_OF_CONDUCT.md`, `CODEOWNERS`.
- API reference: link the generated OpenAPI UI from the README.

- **AC1:** A new contributor goes from clone to authenticated `GET /api/contacts` using only the README, in under 15 minutes.
- **AC2:** All community health files present (GitHub's community profile check is green).

### 3.2 Example client + seed data
`docker compose --profile seed` loads a demo org, user, branches and contacts; add a `examples/` script (curl or tiny TS client) demonstrating sign-up → create contact → list. *(analysis §1.2 — proves the happy path end to end)*

- **AC1:** The example script runs against the compose stack with zero manual SQL.

### 3.3 Release engineering
Make releases reproducible: pin release-it to run in CI (not on a laptop with a dev DB), publish Docker images with semver tags, generate GitHub Releases from the changelog, consider `changesets` if packages ever publish independently. *(analysis §2.2 release-it coupling, §8)*

- **AC1:** ` vX.Y.Z` tag produces: changelog entry, GitHub Release, Docker image — from CI only.
- **AC2:** No release step requires a local database.

### 3.4 Performance baseline
Add a k6/artillery smoke load profile (sign-in, list contacts, bulk import) run manually or nightly; record p95 baseline; add the list-query index check (§1.4) as a regression test on query plans if practical. *(analysis §4 circuit-breaker/pool items feed into this)*

- **AC1:** A documented baseline (p50/p95 for the three scenarios) exists in `docs/performance.md`.
- **AC2:** Nightly job fails on >50% regression (once baseline is stable).

---

## Explicit non-goals (for now)

- **RLS as mandatory** — stretch goal in §2.6; the app-level fixes (§0.4, §1.4) are the required floor.
- **Event bus / outbox** — deferred until the messaging phases (WAHA/email routing) land; keep the door open by writing audit rows transactionally.
- **Microservices split** — the monolith-in-packages structure is right for this size; revisit only with a concrete scaling pressure.
- **GraphQL** — out of scope; the REST + OpenAPI contract is the product surface.

---

## Suggested tracking

Create one GitHub milestone per phase and one issue per numbered item (e.g. "P0.4 Close the multi-tenant holes"), copying the acceptance criteria into the issue body. The roadmap notes currently living in `.env` (phases 3–6 of the original plan: routing engines, WAHA, email providers, webhooks) should be filed as a **post-P3** milestone called "Messaging platform" — they are product features and do not block any P0–P3 item.
