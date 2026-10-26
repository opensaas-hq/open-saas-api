# Overview

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 1. Executive Summary

Open SaaS API is a multi-tenant SaaS backend built on **Bun**, **Hono**,
**Drizzle ORM**, **Better Auth**, **PostgreSQL**, **Zod**, and **GraphQL Yoga**.

The product domain currently covers:

- users, sessions, and credentials via Better Auth;
- organizations and memberships via the Better Auth organization plugin;
- a project-owned registration flow with pluggable admission modes;
- branches and contacts (a small CRM surface);
- audit logging for mutations;
- idempotent write endpoints;
- REST (OpenAPI 3.1) and GraphQL APIs over the same service layer;
- tenant isolation enforced in application code and, optionally, by PostgreSQL
  row-level security (RLS).

The architecture is deliberately layered:

```text
HTTP / GraphQL transport
        |
        v
middleware: request id -> in-flight -> access log -> headers -> CORS
            -> write rate limit -> body limit -> legacy headers
        |
        v
authentication + tenant resolution + RBAC
        |
        v
route handler / GraphQL resolver (thin adapters)
        |
        v
domain service (rules, transactions, auditing)
        |
        v
repository (tenant-scoped queries)
        |
        v
Drizzle ORM / postgres.js / PostgreSQL
```

Key architectural choices:

- **Composition root injection.** `createApp()` receives `env`, `db`, `auth`,
  `logger`, and optionally `lifecycle` and `breaker`. Request handlers read them
  from the Hono context, not from module-level singletons.
- **Session-derived tenancy.** The tenant is always
  `session.activeOrganizationId`; clients cannot choose an arbitrary tenant in a
  request body.
- **Defense in depth.** Application queries always include `organization_id`;
  the three business tables additionally support PostgreSQL RLS.
- **Transactional writes where atomicity matters.** Registration and bulk contact
  imports run in one transaction. Some single-row audit writes are currently
  outside the mutation transaction (see gaps).
- **Typed boundaries.** Zod validates requests and describes REST responses;
  Drizzle types database rows; DTO mappers define the wire format.
- **Contract drift checks.** Committed OpenAPI JSON and GraphQL SDL snapshots are
  compared against the running definitions in CI.

The repository is production-oriented but **not fully production-complete**.
The most urgent operational gaps are a missing `start` script used by the
Dockerfile, a Dockerfile reference to a non-existent `commitlint.config.cjs`, a
missing seed script referenced by Compose, and an environment-variable mismatch
for CORS. See section 20.

---

## 2. System Context and Runtime

### 2.1 Primary runtime

| Concern | Choice |
| --- | --- |
| Runtime | Bun 1.4.2 (Docker image and CI pin) |
| HTTP framework | Hono 4 + `@hono/zod-openapi` |
| Server entry | `Bun.serve({ fetch: app.fetch })` in `apps/api/src/index.ts` |
| Database | PostgreSQL 16 (Docker/CI) |
| ORM/driver | Drizzle ORM + `postgres` (postgres.js) |
| Auth | Better Auth 1.x with Drizzle adapter |
| API contracts | OpenAPI 3.1 + GraphQL SDL |
| Validation | Zod 4 |
| Logging | Pino, optionally `pino-pretty` in development |
| Tests | `bun:test` |
| Lint/format | Biome 1.9 |
| Language | TypeScript, strict mode, ESM, bundled module resolution |

### 2.2 External dependencies

Runtime dependencies:

- **PostgreSQL** — the only stateful dependency required to serve traffic.
- **Email provider** — represented by the `EmailSender` port. The shipped default
  is a silent no-op, so verification and password-reset emails are not delivered.
- **Payment provider** — represented by `PaymentVerificationPort`. The shipped
  default denies every payment, so `paid_required` registration always refuses.
- **Swagger UI CDN** — `/api/v1/docs` loads `swagger-ui-dist` from jsDelivr.
- **Optional proxy headers** — Cloudflare and generic reverse-proxy headers are
  used for client IP and geo telemetry.

There is no queue, cache server, object storage, search engine, metrics backend,
or tracing backend in the current code.

### 2.3 Deployment topology (as written)

```text
Browser / API client
        |
        v
   Bun process (apps/api)
        |  /healthz, /readyz
        |  /api/auth/*        -> Better Auth
        |  /api/v1/*          -> REST product API
        |  /graphql           -> GraphQL Yoga
        v
PostgreSQL 16
```

`docker-compose.yml` also defines a one-shot `migrate` service and an optional
`seed` profile. See section 19 for their current issues.

### 2.4 Explicit non-goals in the current code

The following directories exist but contain no implementation:

- `packages/automation`
- `packages/billing`
- `packages/crm`
- `packages/messaging`
- `packages/pipeline`
- `packages/webhooks`

They are placeholders for future bounded contexts. The current CRM/branch code
lives in `apps/api` and `packages/database`, not in `packages/crm`.

There is also no background worker, outbox, event bus, webhook delivery,
billing, messaging, or automation engine yet.

---

## 3. Repository Layout and Package Graph

```text
open-saas-api/
├── apps/
│   └── api/                       # HTTP + GraphQL application
│       ├── src/
│       │   ├── app.ts             # composition root
│       │   ├── index.ts           # process boot + Bun.serve
│       │   ├── types.ts           # Hono context/service types
│       │   ├── lifecycle.ts       # drain/in-flight state
│       │   ├── shutdown.ts        # SIGTERM/SIGINT controller
│       │   ├── dto/               # Zod request/response schemas + mappers
│       │   ├── graphql/           # Yoga endpoint, schema, resolvers, safety
│       │   ├── health/            # database probe port
│       │   ├── middleware/        # pipeline, tenant, RBAC, rate limit
│       │   ├── openapi/           # document, responses, Swagger, legacy
│       │   ├── routes/            # REST adapters
│       │   ├── services/          # domain rules and orchestration
│       │   └── __tests__/         # integration/HTTP/unit suites
│       ├── scripts/               # OpenAPI/GraphQL snapshot tools
│       ├── openapi.json           # committed REST contract snapshot
│       └── graphql.schema.graphql # committed GraphQL contract snapshot
├── packages/
│   ├── core/                      # config, errors, response, logger, audit, redact
│   ├── auth/                      # Better Auth factory, registration strategies, ports
│   ├── database/                  # schema, client, repositories, RLS, migrations
│   ├── automation/                # empty placeholder
│   ├── billing/                   # empty placeholder
│   ├── crm/                       # empty placeholder
│   ├── messaging/                 # empty placeholder
│   ├── pipeline/                  # empty placeholder
│   └── webhooks/                  # empty placeholder
├── docs/                          # architecture and development guide
├── docker-compose.yml
├── Dockerfile
├── .github/workflows/ci.yml
├── .github/workflows/cd.yml
├── package.json                   # Bun workspaces: packages/*, apps/*
└── README.md                      # project entry point
```

### 3.1 Package responsibilities

| Package | Responsibility | May depend on |
| --- | --- | --- |
| `@opensaas/core` | Configuration schema, error hierarchy, response envelope, logger, redaction, audit contracts/helpers | Third-party only (`zod`, `pino`); no workspace packages |
| `@opensaas/database` | Drizzle schema, client, transactions, RLS, repositories, migrations | `@opensaas/core` |
| `@opensaas/auth` | Better Auth construction, email policy, telemetry, registration strategies/ports | `@opensaas/core`, `@opensaas/database` |
| `@opensaas/api` | HTTP/GraphQL transport, middleware, services, DTOs, contracts | all three packages |

There is a deliberate dependency cycle avoidance rule enforced by a test:
`packages/core` must not import another workspace package.
`packages/database` does import `@opensaas/core` (notably for errors, env, and
the audit port), so the graph is not strictly acyclic with respect to an ideal
"database is a leaf" design; this is acknowledged in source comments.

### 3.2 Workspace commands

Root `package.json` scripts:

| Command | Behavior |
| --- | --- |
| `bun run dev` | Runs `@opensaas/api dev` with `.env` and watch mode |
| `bun run build` | Runs `build` in every workspace that defines it |
| `bun run typecheck` | Runs `typecheck` in every workspace |
| `bun test` | Runs all tests |
| `bun run test:unit` | Attempts a unit-only pattern; falls back to selected suites |
| `bun run test:integration` | Runs `bun test apps packages` ignoring `*.unit.*` |
| `bun run lint` | `biome check .` |
| `bun run format` | `biome format --write .` |
| `bun run release` | `release-it` |

Important: `apps/api`, `packages/core`, `packages/database`, and `packages/auth`
define `typecheck`. Only `apps/api` defines `build`. `@opensaas/auth` has no
build script. Docker's build stage tolerates this with `|| true`.

---

## Related

- [Runtime](runtime.md)
- [API](api.md)
- [Multi-tenancy](multi-tenancy.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
