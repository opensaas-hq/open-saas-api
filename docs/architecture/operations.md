# Operations and Observability

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 16. Middleware, Logging, and Observability

### 16.1 Pipeline order

Mounted on every request, including `/api/auth/*`:

1. **Request ID**
   - Accepts `x-request-id` only if 1–64 chars matching
     `^[A-Za-z0-9._-]+$`.
   - Otherwise generates a UUID.
   - Sets `x-request-id` on the response.
   - Opens an `AsyncLocalStorage` request context.
2. **In-flight tracker**
   - Increments before the handler, decrements in `finally`.
   - Feeds graceful shutdown.
3. **Access log**
   - One structured line after the response or error.
   - Fields: request id, tenant id, user id, method, pathname, matched route,
     status, duration.
   - Excludes query strings, bodies, and headers.
4. **Security headers** (`secureHeaders()` defaults).
5. **CORS**
   - Origin allowlist = `BETTER_AUTH_URL` + `TRUSTED_ORIGINS`.
   - Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS.
   - Allowed request headers: `Content-Type`, `Authorization`, `X-Branch-Id`,
     `X-Request-Id`.
   - Exposed response headers: `X-Request-Id`.
   - Credentials allowed; preflight cached 600 s.
6. **Write rate limiter** (optional).
   - Only `POST`, `PUT`, `PATCH`, `DELETE`.
   - Key = method + client IP.
   - Applies before body parsing and before the auth handler.
7. **Body limit**
   - Global maximum `BODY_SIZE_LIMIT_BYTES`.
   - Returns the standard 413 envelope.

Route-level, after the pipeline:

- Better Auth handler for `/api/auth/*`.
- Health routes (no session).
- Tenant middleware for `/graphql` and every product route.
- RBAC route middleware.
- Zod validation hook.
- Handler.

### 16.2 CORS gaps

- `Idempotency-Key` is not in `Access-Control-Allow-Headers`; browser clients
  cannot use idempotent writes cross-origin without a preflight failure.
- `If-None-Match` is not listed either; conditional ETag requests from browser
  JavaScript may be blocked.
- `idempotent-replayed` and `ETag` are not in `Access-Control-Expose-Headers`;
  cross-origin JavaScript cannot read them reliably.
- `X-Request-Id` is the only exposed custom response header.

### 16.3 Logging

- Logger: Pino.
- Output: pretty in development; JSON otherwise.
- Level: `LOG_LEVEL`.
- Per-request child bindings from `AsyncLocalStorage`.
- Redaction:
  - Case-insensitive, recursive.
  - Keys: `authorization`, `cookie`, `password`, `token`, `set-cookie`.
  - Replacement: `[REDACTED]`.
- Errors are logged with structured metadata; unknown errors are logged before
  being masked.
- Passwords, auth headers, cookies, and tokens are covered by redaction.
- Email addresses, names, phone numbers, IPs, and user agents are **not**
  redacted by the shared helper. The access log avoids them by logging only
  identifiers, but error details can still include them.

### 16.4 Health and readiness

| Endpoint | Semantics |
| --- | --- |
| `GET /healthz` | Process alive; no dependency; includes draining flag |
| `GET /readyz` | Not draining, breaker not open, DB `SELECT 1` within timeout |
| `GET /api/health` | Deprecated alias of readiness |

Readiness failure bodies include a `reason`:
`draining`, `circuit_open`, or `database_unreachable`.

### 16.5 Lifecycle and shutdown

- `SIGTERM`/`SIGINT` install once.
- Sequence:
  1. mark draining (readiness → 503),
  2. stop accepting connections,
  3. wait for in-flight requests up to `SHUTDOWN_DRAIN_TIMEOUT_MS`,
  4. close the DB pool,
  5. flush logs,
  6. exit 0 if drained, 1 if timed out.
- A second signal exits immediately with `128 + signal`.
- In-flight accounting is in memory and covers requests that reached the HTTP
  pipeline.

### 16.6 Observability gaps

- No metrics endpoint (Prometheus/OpenTelemetry).
- No distributed tracing; only request-id correlation.
- No error tracker (Sentry, etc.).
- No audit-log query API or export.
- Breaker counters (`rejected`, `trips`) exist in code but are not exported.
- GraphQL resolver timings are not measured separately.
- Rate-limit counters and membership cache size are not observable.
- There is no alerting contract, SLO, or dashboard in the repository.

---

## 19. Build, Deployment, and Operations

### 19.1 Local development

```bash
bun install
cp .env.example .env
# Start PostgreSQL, then:
bun --filter @opensaas/database db:migrate
bun run dev
```

- `bun run dev` runs `@opensaas/api` with `.env` and watch mode.
- Bun executes TypeScript directly; there is no compile step in development.
- Tests need a dedicated database and `.env.test` with
  `DATABASE_URL === DATABASE_URL_TEST`.
- The RLS suites additionally need `db:rls:test` and `RLS_ENABLED=true`.

### 19.2 Build outputs

- Root `build` runs `bun run --filter "*" build`.
- Only `@opensaas/api` declares a `build` script:
  `bun build src/index.ts --outdir dist`.
- `@opensaas/core`, `@opensaas/auth`, and `@opensaas/database` have no build
  scripts; they are consumed as TypeScript source through workspace `main`
  fields.
- The runtime does not consume `dist`; `index.ts` is executed directly.
- Consequently, the current “build” is mostly a type/bundle check, not a
  deployable artifact.

### 19.3 Dockerfile

Stages:

1. `base`: `oven/bun:1.4.2`, workdir `/app`, `NODE_ENV=production`.
2. `deps`: copies manifests, apps, packages, tsconfigs, Biome config,
   `commitlint.config.cjs`; installs with frozen lockfile (dev dependencies
   included).
3. `build`: attempts per-package builds, swallowing failures with `|| true`.
4. `runtime`: non-root `bunjs` user, copies `node_modules`, manifests, apps,
   packages, tsconfigs; exposes 3000; healthcheck `/healthz`;
   `CMD ["bun","run","--filter","@opensaas/api","start"]`.

Problems:

- `COPY ... commitlint.config.cjs` fails because the repository contains
  `commitlint.config.mjs`, not `.cjs`.
- The runtime CMD calls a `start` script that `apps/api/package.json` does not
  define.
- The build stage is unused by the runtime stage. The runtime copies source and
  installs all dependencies, not just the built output.
- `|| true` hides package build failures.
- No `.dockerignore`; the build context can include `.git`, `node_modules`,
  local env files, and `docs/`. Docker only `COPY`s selected paths, but a large
  or sensitive build context is still a risk.
- `NODE_ENV=production` is set in `base`, including the deps stage, but
  `bun install --production=false` mitigates missing dev dependencies.
- The healthcheck uses liveness (`/healthz`), not readiness (`/readyz`).
- No migration or RLS bootstrap runs at container start; Compose has a separate
  migrate service, but RLS is not applied there.

### 19.4 Docker Compose

Services:

- `postgres`: Postgres 16 Alpine, hard-coded `admin`/`omarchy` credentials,
  named volume.
- `migrate`: builds the `deps` stage, runs `db:migrate`, exits.
- `api`: builds `runtime`, waits for Postgres and migrate, port 3000,
  `/healthz` healthcheck.
- `seed`: optional profile, runs `bun run scripts/seed.ts`.

Problems:

- The seed command points at a root `scripts/seed.ts` that does not exist.
- `CORS_ORIGINS` is passed, but the config reads `TRUSTED_ORIGINS`.
- No RLS bootstrap service or `RLS_ENABLED` setting.
- Credentials and auth secret are development defaults; production must
  override them.
- No reverse proxy, TLS termination, backup, or observability sidecar.
- The API container does not have a migration dependency at runtime beyond
  Compose ordering; running the image elsewhere requires an external migration
  step.
- The Docker build currently cannot succeed because the `Dockerfile` copies the
  missing `commitlint.config.cjs`. The runtime `CMD` also references a missing
  `start` script.

### 19.5 CI/CD

CI (`.github/workflows/ci.yml`):

- Postgres 16 service.
- Bun 1.4.2.
- Frozen install, lint, typecheck, OpenAPI check, GraphQL check, migrations,
  full tests.
- Dedicated RLS job with bootstrap and `RLS_ENABLED=true`.
- No Docker build in CI; the Dockerfile breakage is therefore not caught until
  CD.
- Main test job does not set `DATABASE_URL_TEST`; see §18.6.

CD (`.github/workflows/cd.yml`):

- Trigger: tags `v*`.
- Lint, typecheck, `bun run build`.
- Docker metadata tags: version, major/minor, major, sha.
- Buildx build/push to GHCR.
- GitHub release with generated notes.
- No deployment step to a runtime environment; the workflow publishes an
  image only.
- No migration or RLS step in CD.

Release tooling:

- `release-it` with conventional changelog.
- `before:init` runs lint, typecheck, and tests locally.
- Commitlint uses `commitlint.config.mjs`, while the Dockerfile expects `.cjs`.

### 19.6 Production checklist implied by the code

1. Provision PostgreSQL and create the database.
2. Run Drizzle migrations.
3. Create `opensaas_app`, grants, and RLS policies if `RLS_ENABLED=true`.
4. Set a real `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`,
   `DATABASE_URL`, and registration mode.
5. Avoid the Compose default credentials.
6. Terminate TLS at a trusted proxy; ensure proxy headers are set by that proxy
   only.
7. Use an external email sender and payment verifier if those modes are used.
8. Scale horizontally only with awareness that rate limits and membership cache
   are per instance.
9. Monitor `/readyz`, not only `/healthz`.
10. Drain on shutdown with a budget longer than the longest expected request.
11. Back up PostgreSQL, including Better Auth tables and audit data.
12. Define retention for sessions, audit, idempotency, and logs.
13. Fix the Docker `start` script / config copy before relying on the image.

---

## Related

- [Runtime](runtime.md)
- [Configuration](configuration.md)
- [Security](security.md)
- [Testing](testing.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
