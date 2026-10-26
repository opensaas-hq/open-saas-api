# Reference

> Part of the [Open SaaS API documentation](README.md). Section numbers are kept from the original architecture guide for traceability.

## 23. File and Module Index

### 23.1 Root

| Path | Purpose |
| --- | --- |
| `package.json` | Workspace scripts: dev, build, typecheck, test/test:unit/test:integration, lint, format, prepare, release |
| `bun.lock` | Frozen dependency lockfile |
| `tsconfig.json` | Strict TypeScript base |
| `biome.json` | Lint/format rules; ignores migrations and snapshots |
| `commitlint.config.mjs` | Conventional commit types |
| `.release-it.json` | Release/tag/changelog configuration |
| `.env.example` | Documented environment template (contains drift) |
| `Dockerfile` | Multi-stage image (currently broken; see §19/§20) |
| `docker-compose.yml` | Postgres, migrate, API, optional seed |
| `README.md` | Quickstart and commands |
| `SECURITY.md` | Private vulnerability reporting |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS` | Project process |
| `.github/workflows/ci.yml` | Lint, typecheck, contracts, tests, RLS proof |
| `.github/workflows/cd.yml` | Tagged release, GHCR image |
| `docs/README.md` | Documentation index and quick map |

### 23.2 API application

| Path | Purpose |
| --- | --- |
| `apps/api/src/index.ts` | Boot: config, logger, auth, DB wait, RLS proof, server, shutdown |
| `apps/api/src/app.ts` | Composition root: DI, pipeline, auth mount, routes, errors |
| `apps/api/src/types.ts` | `AppEnv`, services, tenant/session types |
| `apps/api/src/lifecycle.ts` | Draining and in-flight tracking |
| `apps/api/src/shutdown.ts` | Signal-driven graceful shutdown |
| `apps/api/src/health/probe.ts` | Readiness DB probe port |
| `apps/api/src/routes/health.ts` | `/healthz`, `/readyz`, `/api/health` |
| `apps/api/src/routes/contacts.ts` | Contacts REST, ETag, idempotency, bulk |
| `apps/api/src/routes/branches.ts` | Branches REST, ETag |
| `apps/api/src/routes/registration.ts` | Project-owned registration |
| `apps/api/src/middleware/pipeline.ts` | Request ID, in-flight, log, headers, CORS, limiter, body limit |
| `apps/api/src/middleware/request-id.ts` | Correlation id and async context |
| `apps/api/src/middleware/access-log.ts` | One structured log line per request |
| `apps/api/src/middleware/in-flight.ts` | Lifecycle request counter |
| `apps/api/src/middleware/rate-limit.ts` | Per-process write limiter |
| `apps/api/src/middleware/tenant.ts` | Session → tenant/membership/branch |
| `apps/api/src/middleware/rbac.ts` | Permission matrix and guards |
| `apps/api/src/services/contacts.service.ts` | Contact rules, branch validation, audit, bulk transaction |
| `apps/api/src/services/branches.service.ts` | Branch ownership, CRUD, audit |
| `apps/api/src/services/membership.service.ts` | Role lookup cache, role/member mutations, audit |
| `apps/api/src/services/organizations.service.ts` | Active organization read |
| `apps/api/src/services/registration.service.ts` | Registration orchestration and audit |
| `apps/api/src/services/idempotency.service.ts` | Canonical hashing, claim/replay/TTL |
| `apps/api/src/dto/contacts.ts` | Contact schemas, query/param/bulk, DTO mapper |
| `apps/api/src/dto/branches.ts` | Branch schemas and mapper |
| `apps/api/src/dto/organizations.ts` | Organization schema and mapper |
| `apps/api/src/dto/registration.ts` | Registration request/response schemas |
| `apps/api/src/dto/metadata.ts` | Metadata depth/size validation |
| `apps/api/src/dto/validation.ts` | Shared Hono validation hook |
| `apps/api/src/graphql/schema.ts` | SDL and executable schema |
| `apps/api/src/graphql/resolvers.ts` | Query/mutation resolvers |
| `apps/api/src/graphql/context.ts` | Yoga context from Hono |
| `apps/api/src/graphql/guards.ts` | Permission guard |
| `apps/api/src/graphql/errors.ts` | Error mapping and masking |
| `apps/api/src/graphql/presenters.ts` | Status enum mapping |
| `apps/api/src/graphql/safety.ts` | Depth/cost/introspection plugin |
| `apps/api/src/graphql/yoga.ts` | Yoga endpoint factory |
| `apps/api/src/openapi/document.ts` | OpenAPI 3.1 config and builder |
| `apps/api/src/openapi/responses.ts` | Reusable error response docs |
| `apps/api/src/openapi/swagger.ts` | Swagger UI HTML and CSP |
| `apps/api/src/openapi/legacy.ts` | Deprecated path headers |
| `apps/api/openapi.json` | Committed OpenAPI snapshot |
| `apps/api/graphql.schema.graphql` | Committed GraphQL SDL snapshot |
| `apps/api/scripts/*` | Generate/check contract snapshots |
| `apps/api/src/__tests__/*` | API, auth, tenancy, CRUD, GraphQL, health, shutdown tests |

### 23.3 Core package

| Path | Purpose |
| --- | --- |
| `packages/core/src/config.ts` | Env schema, trusted origins, config boot/test seams |
| `packages/core/src/errors.ts` | Error hierarchy and status mapping |
| `packages/core/src/response.ts` | Success/failure envelopes and helpers |
| `packages/core/src/logger.ts` | Pino factory, request context, redaction |
| `packages/core/src/redact.ts` | Recursive case-insensitive redaction |
| `packages/core/src/audit.ts` | Audit types, diff, redaction, ports |
| `packages/core/src/index.ts` | Public exports |

### 23.4 Auth package

| Path | Purpose |
| --- | --- |
| `packages/auth/src/auth.ts` | Better Auth factory, plugins, rate limits, telemetry hook |
| `packages/auth/src/email-policy.ts` | Email normalization and disposable blocking |
| `packages/auth/src/telemetry.ts` | Header-based IP/device/geo extraction |
| `packages/auth/src/ports/email.ts` | Email sender port and no-op default |
| `packages/auth/src/ports/payment.ts` | Payment verification port and deny-all default |
| `packages/auth/src/registration/service.ts` | Transactional registration flow |
| `packages/auth/src/registration/index.ts` | Public re-exports of the registration module |
| `packages/auth/src/registration/registry.ts` | Mode → strategy registry |
| `packages/auth/src/registration/registry-factory.ts` | Production registry wiring |
| `packages/auth/src/registration/types.ts` | Strategy contracts |
| `packages/auth/src/registration/strategies/public.ts` | Public admission |
| `packages/auth/src/registration/strategies/waiting-list.ts` | Waitlist admission |
| `packages/auth/src/registration/strategies/invite-code.ts` | Invite admission |
| `packages/auth/src/registration/strategies/paid-required.ts` | Paid admission |
| `packages/auth/src/registration/validators/database-invite-code.ts` | DB invite lookup/consume |
| `packages/auth/src/index.ts` | Public exports |

### 23.5 Database package

| Path | Purpose |
| --- | --- |
| `packages/database/src/schema.ts` | All Drizzle tables, enums, indexes |
| `packages/database/src/client.ts` | Pool, lazy handle, retry/breaker, tenant transactions |
| `packages/database/src/client/health.ts` | Timed `SELECT 1` probe |
| `packages/database/src/client/resilience.ts` | Retry, circuit breaker, transient SQLSTATEs |
| `packages/database/src/client/rls.ts` | RLS table list, verification, boot assertion |
| `packages/database/src/repositories/contact.ts` | Tenant contact queries |
| `packages/database/src/repositories/branch.ts` | Tenant branch queries |
| `packages/database/src/repositories/audit.ts` | Audit port implementation and listing |
| `packages/database/src/repositories/idempotency.ts` | Claim/read/complete/delete keys |
| `packages/database/src/repositories/member.ts` | Membership lookup/mutation |
| `packages/database/src/repositories/organization.ts` | Organization read/create |
| `packages/database/src/repositories/registration-code.ts` | Invite code lookup/consume |
| `packages/database/src/repositories/waitlist.ts` | Waitlist persistence |
| `packages/database/src/repositories/like.ts` | Safe contains-pattern builder |
| `packages/database/drizzle/*.sql` | Generated migrations |
| `packages/database/drizzle/meta/*` | Migration journal/snapshots |
| `packages/database/sql/rls-setup.sql` | Role, grants, enable/force, policies |
| `packages/database/sql/rls-teardown.sql` | RLS teardown |
| `packages/database/scripts/apply-rls.ts` | Apply/teardown CLI |
| `packages/database/drizzle.config.ts` | Drizzle Kit config |
| `packages/database/src/__tests__/*` | Repositories, schema, RLS, resilience tests |

### 23.6 Empty placeholders

`packages/automation`, `packages/billing`, `packages/crm`, `packages/messaging`,
`packages/pipeline`, `packages/webhooks` exist as empty directories. They are
not part of the workspace dependency graph and contain no code. They are tracked
as TD-50 in [Technical Debt](technical-debt.md#206-future-packages) and in the
[Roadmap Backlog](roadmap.md#backlog).

### 23.7 Documentation

| Path | Purpose |
| --- | --- |
| `docs/README.md` | Documentation index, reading paths, and change map |
| `docs/architecture/overview.md` | Purpose, runtime context, repository layout |
| `docs/architecture/runtime.md` | Boot, shutdown, request lifecycle |
| `docs/architecture/configuration.md` | Environment schema and configuration gaps |
| `docs/architecture/api.md` | REST, GraphQL, OpenAPI, Swagger |
| `docs/architecture/authentication.md` | Better Auth, sessions, organizations, registration |
| `docs/architecture/multi-tenancy.md` | Tenancy, RLS, RBAC, branch scoping, ADR-0001 |
| `docs/architecture/data-and-services.md` | Schema, persistence, transactions, services |
| `docs/architecture/operations.md` | Logging, health, build, deployment, CI/CD |
| `docs/architecture/security.md` | Trust boundaries, secrets, PII, residual risks |
| `docs/architecture/testing.md` | Runner, isolation, helpers, coverage, CI |
| `docs/development-guide.md` | Playbooks and architectural invariants |
| `docs/technical-debt.md` | Known gaps grouped by package, release blockers, tracked issues |
| `docs/roadmap.md` | Phases 1–6, backlog and ongoing engineering work |
| `docs/reference.md` | File index, glossary, reading order |
| `docs/examples/demo.ts` | Runnable end-to-end example |

---

## 24. Glossary

| Term | Meaning |
| --- | --- |
| **Tenant** | An organization; the isolation boundary for business data |
| **Organization** | Better Auth entity that owns memberships and business rows |
| **Active organization** | `session.activeOrganizationId`; the tenant of the request |
| **Membership** | Row in `member` linking a user to an organization with a role |
| **Role** | `owner`, `admin`, or `member` |
| **Permission** | Named operation in `PERMISSION_MATRIX`, mapped to allowed roles |
| **RLS** | PostgreSQL Row-Level Security; database-enforced tenant filtering |
| **GUC** | PostgreSQL custom setting; here `app.current_org` |
| **`opensaas_app`** | Non-superuser, non-BYPASSRLS role used when RLS is enabled |
| **Branch** | Tenant-owned grouping for contacts |
| **Contact** | CRM person record with status, opt-in, and metadata |
| **Audit event** | Immutable-by-convention record of a mutation |
| **Audit diff** | Shallow before/after map of changed fields |
| **Idempotency key** | Client-supplied key that makes a write safely replayable |
| **Scope** | Logical owner of an idempotency key (tenant or registration identity) |
| **Replay** | Returning a stored response instead of re-running an operation |
| **Claim** | Inserting the idempotency key to become the single executor |
| **In-flight** | Request currently being served during shutdown |
| **Drain** | Waiting for in-flight requests before closing resources |
| **Liveness** | “Process is running”; `/healthz` |
| **Readiness** | “Process can serve traffic”; `/readyz` |
| **Circuit breaker** | Fail-fast state machine around database calls |
| **Transient error** | SQLSTATE classified as retryable (connection, deadlock, etc.) |
| **Adapter/Port** | Interface for external capability (email, payment) |
| **Strategy** | Registration admission policy for one mode |
| **Registry** | Exhaustive mode → strategy mapping |
| **Waitlist** | Admission mode that records an entry instead of enabling the account |
| **Invite code** | Standalone, optionally multi-use registration token |
| **Registration code** | Project table for invite tokens, distinct from org invitations |
| **Snapshots** | Committed OpenAPI JSON and GraphQL SDL used for drift checks |
| **Drift check** | CI comparison of generated contract against committed snapshot |
| **PDD** | Not used in this repository |
| **PII** | Personally identifiable information (name, email, phone, IP, etc.) |
| **DTO** | Data transfer object: the wire shape returned by services/routes |
| **Envelope** | Standard `{ success, data/error }` response wrapper |
| **Deprecated alias** | Unprefixed path served with `Deprecation`/`Sunset`/`Link` headers |
| **Populated later** | Reserved for future modules; currently empty |

---

## 25. Suggested Reading Order

The section-to-file map is in [the documentation index](README.md).

For a new developer:

1. §1–§6 for purpose, runtime, layout, boot, request flow, config.
2. §10 for tenancy, the most important rule in the system.
3. §7–§9 for the HTTP/auth/registration contracts.
4. §11–§13 for data and domain behavior.
5. §14–§16 for GraphQL, contracts, middleware, and observability.
6. §17 for security/privacy constraints.
7. §18–§19 for tests and deployment.
8. Check [technical-debt.md](technical-debt.md) for known gaps.
9. Read [development-guide.md](development-guide.md) §21–§22 before making a change.
10. See [roadmap.md](roadmap.md) for planned work.
11. §23–§24 for file lookup and vocabulary.

For a coding agent:

1. Read [invariants](development-guide.md#22-architectural-invariants-and-coding-rules) first.
2. Identify the layer owning the change via §23/[file index](#23-file-and-module-index).
3. Check the relevant playbook in [development-guide.md §21](development-guide.md#21-extension-playbooks).
4. Verify the current gap in [technical-debt.md](technical-debt.md).
5. Plan against [roadmap.md](roadmap.md) if the change aligns with planned work.
6. Run `bun run lint`, `bun run typecheck`, and the relevant tests.
7. Regenerate contract snapshots when routes/schemas change.
8. Never bypass tenant scoping, the test DB guard, or the permission matrix.

---

## Related

- [Docs index](README.md)
