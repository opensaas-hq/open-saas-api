# Runtime and Request Lifecycle

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 4. Boot Sequence and Process Lifecycle

The process entry is `apps/api/src/index.ts`. Importing it has side effects: it
validates config, connects to the database, starts a server, and installs signal
handlers. Do not import it from unit tests.

### 4.1 Boot order

1. **`initConfig()`**
   - Parses `process.env` through `envSchema`.
   - On failure, writes one structured JSON line to stderr and calls
     `process.exit(1)`.
   - On success, memoizes the validated `Env`.

2. **Build logger and auth**
   - `createLogger(env)` creates the Pino logger.
   - `createAuth(env, db)` creates the Better Auth instance with the global
     Drizzle handle.
   - Neither is a module-level imported singleton at request time.

3. **Create lifecycle**
   - `createLifecycle()` tracks draining state and in-flight request count.

4. **`await waitForDatabase()`**
   - Runs `SELECT 1` through the database client.
   - Retries transient failures using the configured backoff.
   - Throws `ServiceUnavailableError` if the database remains unreachable.
   - Because this is top-level await, the process does not start listening until
     the database probe succeeds or the retry budget fails.

5. **Optional RLS boot assertion**
   - If `RLS_ENABLED=true`, runs `executeResilient(() => assertRlsEnforcement(db))`.
   - Verifies the effective role is not superuser/BYPASSRLS, all three business
     tables have `ENABLE` + `FORCE` RLS, and `app.current_org` can be set/read.
   - A failed assertion aborts boot.

6. **`createApp(...)`**
   - Builds services and routes; see section 5.

7. **`Bun.serve({ port: Number(env.PORT), fetch: app.fetch })`**
   - Starts accepting connections.

8. **Install shutdown controller**
   - Listens for `SIGTERM` and `SIGINT`.
   - Logs the listening message.

The module exports `{ app, server, shutdown }`.

### 4.2 Graceful shutdown order

Defined in `apps/api/src/shutdown.ts`:

1. On first signal, set lifecycle to **draining**. `/readyz` immediately returns
   503.
2. Call `server.stop(false)`, which stops accepting new connections while
   allowing in-flight requests to finish.
3. Wait for `lifecycle.whenIdle()` up to `SHUTDOWN_DRAIN_TIMEOUT_MS`.
4. Close the database pool (`close()`).
5. Flush the logger.
6. Exit `0` if drained, `1` if the drain timed out.

A second signal abandons the drain and exits immediately with 130 (`SIGINT`) or
143 (`SIGTERM`).

### 4.3 Lifecycle invariants

- `beginRequest()` / `endRequest()` are always paired by middleware `finally`.
- `whenIdle()` resolves immediately when no requests are in flight and never
  rejects.
- Readiness flips before connections are stopped, giving load balancers a window
  to remove the instance.

---

## 5. HTTP Request Lifecycle

`createApp()` in `apps/api/src/app.ts` is the composition root.

### 5.1 Dependency injection slots

Before any route, an app-level middleware sets these on the Hono context:

| Slot | Type | Source |
| --- | --- | --- |
| `env` | validated `Env` | boot |
| `db` | `Database` | boot/injected |
| `auth` | `AuthInstance` | boot/injected |
| `logger` | `Logger` | boot/injected |
| `services` | `AppServices` | built once per app |
| `user` | Better Auth session user | tenant middleware |
| `session` | Better Auth session record | tenant middleware |
| `tenant` | `{ organizationId, branchId?, role }` | tenant middleware |

The slots are declared in `AppVariables` / `AppEnv` in `apps/api/src/types.ts`.
A `c.set()` without a matching declaration is a compile error.

### 5.2 Services built once per app

`createApp()` constructs:

- `DatabaseAuditRepository(undefined, db)` — shared audit sink.
- `BranchesService` — branch ownership, CRUD, auditing.
- `MembershipService` — role lookup with in-memory TTL cache, role changes,
  removals, auditing.
- `OrganizationsService` — active organization read for GraphQL.
- `ContactsService` — list/read/create/update/delete/bulk, auditing.
- `RegistrationService` — registration flow and audit.
- `IdempotencyService` — replay rules for selected writes.

The membership cache must survive across requests, which is why services are not
created per request.

### 5.3 Global middleware order

Registered in this order for `*`:

1. **DI slots** — sets env/db/auth/logger/services.
2. **`request-id`**
   - Accepts an inbound `x-request-id` only if length 1–64 and matches
     `^[A-Za-z0-9._-]+$`; otherwise generates a UUID.
   - Echoes `x-request-id` on the response.
   - Opens an `AsyncLocalStorage` request context for correlated logs.
3. **in-flight tracker**
   - Increments/decrements the lifecycle counter.
4. **access log**
   - Emits exactly one structured line per request.
   - Logs method, pathname, matched route, status, duration, request id, tenant,
     and user.
   - Never logs query strings, bodies, or headers.
5. **`secureHeaders()`**
   - Applies Hono's security headers, including a restrictive default CSP.
6. **CORS**
   - Origin allowlist is `getTrustedOrigins(env)`: `BETTER_AUTH_URL` plus
     comma-separated `TRUSTED_ORIGINS`.
   - Allows credentials.
   - Allowed request headers: `Content-Type`, `Authorization`, `X-Branch-Id`,
     `X-Request-Id`.
   - Exposes `X-Request-Id`.
   - Preflight max age 600 seconds.
7. **write rate limiter** (if enabled)
   - Applies to `POST`, `PUT`, `PATCH`, `DELETE`.
   - Key is `METHOD:client-ip`.
   - In-memory fixed window per process.
   - Throws 429 with `Retry-After`.
8. **body limit**
   - Rejects bodies over `BODY_SIZE_LIMIT_BYTES` with 413 and the standard error
     envelope.
9. **legacy deprecation middleware**
   - Adds `Deprecation: true`, `Sunset`, and `Link` headers to legacy paths.

Then route-specific middleware runs: Better Auth handler, health, GraphQL tenant
resolution, REST tenant resolution, RBAC, validation, and etag.

### 5.4 Route mount order

1. `/api/auth/*` → Better Auth handler (framework-owned).
2. `/` health router → `/healthz`, `/readyz`, `/api/health`.
3. `/graphql` → tenant middleware → GraphQL Yoga.
4. `/api/v1/registration` → registration router (anonymous, no tenant middleware).
5. `/api/v1/contacts` → contacts router with tenant middleware internally.
6. `/api/v1/branches` → branches router with tenant middleware internally.
7. `/api/contacts`, `/api/branches`, `/api/registration` → legacy aliases.
8. `/api/v1/openapi.json` → generated document.
9. `/api/v1/docs` → Swagger UI HTML with a relaxed CSP.

`app.notFound()` returns the JSON error envelope, not Hono's plain text.
`app.onError()` maps `AppError` to its status/code/details, sets `Retry-After`
for 429, and masks unknown errors as a generic 500.

### 5.5 Tenant-scoped request sequence

For REST routes mounted with `tenantContextMiddleware` (and `/graphql`):

1. Call `auth.api.getSession({ headers })`; accepts cookies, bearer tokens, and
   API keys supported by Better Auth.
2. Reject missing session with 401 `UNAUTHORIZED`.
3. Require `session.activeOrganizationId`; otherwise 400
   `MISSING_ACTIVE_ORGANIZATION`.
4. Look up the user's role in `member` through `MembershipService`.
5. Reject non-members with 403 `NOT_A_MEMBER`.
6. Resolve `branchId` from `x-branch-id` header or `?branchId=` query.
7. Validate it as a UUID; invalid → 422.
8. Assert the branch belongs to the active organization; otherwise 404.
9. Set `user`, `session`, and `tenant` on the context.
10. Enrich the async request context with `tenantId` and `userId` for logs.

### 5.6 Validation and response shape

- Route definitions use `createRoute()` from `@hono/zod-openapi`.
- Request validation failures are converted by `validationHook()` into a 422
  envelope with Zod flattened errors.
- Success handlers call `ok(data, pagination?)`.
- Errors are built from `AppError` subclasses and serialized by `app.onError`.
- Unknown routes produce 404 `NOT_FOUND`.

---

## Related

- [Overview](overview.md)
- [API](api.md)
- [Operations](operations.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
