# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - Unreleased / Initial MVP Core

### Added
- **Monorepo Architecture (Phase 1):** Configured Bun Workspaces (`packages/*` and `apps/api`), Biome linter/formatter, Zod environment validation (`@opensaas/core`), standard error handling system (`AppError`), and health check routes.
- **Auth & Telemetry (Phase 2):** Integrated Better Auth with Drizzle ORM PostgreSQL schema. Added session telemetry, device fingerprinting, and real IP extraction supporting Cloudflare and reverse proxies.
- **Multi-Tenancy & CRM:** Organization context, member roles, and branch-level tenant isolation middleware in Hono. Implemented Base CRM `/api/contacts` routes (individual creation, organization-isolated listing with pagination/search, opt-in consent, and bulk import).
- **Quality & Isolation:** Global HTTP error interceptor, structured Pino logger, and comprehensive testing suite with 26 passing unit/integration tests running via `bun test`.

## [0.1.0] - 2026-10-18 (Phase 2.5)

### Added
- **Test Database Infrastructure (`packages/database`):** Configured real PostgreSQL/Supabase connection for integration tests and multi-tenant isolation verification.
- **Email Anti-Abuse & Normalization (`packages/auth`):** 
  - Implemented plus-addressing removal, dot-stripping for Gmail, and case-insensitivity normalization.
  - Added disposable/burner email domain filtering supporting static fallback lists and dynamic extension via `DISPOSABLE_EMAIL_DOMAINS`.
- **Multi-Strategy Registration Modes (`packages/auth`):** Added support for `public`, `waiting_list`, `invite_code`, and `paid_required` registration workflows.
- **Auth Integration Routes (`apps/api`):** Implemented `/api/auth/register` with strict Zod validation and core policy enforcement.
- **Comprehensive Testing Suite:** Achieved 100% test pass rate across the monorepo (44/44 tests green) alongside strict Biome linting and TypeScript typechecking.

## [Unreleased] - Phases 1-5 Complete

### Added
- **Phase 1 - Core Foundation**: Validated config with factories, response envelope helpers (`ok`/`fail`/`fromZodError`), structured logger with request context and redaction, audit port, `zod` dependency
- **Phase 2 - Database**: Uniform repository layer with tenant scoping, schema defenses (indexes, constraints, enums), committed migrations, connection factory with pool config, circuit breaker and retry, LIKE escaping, test isolation
- **Phase 2.5 - RLS**: Row-level security policies for business tables, tenant GUC plumbing, cross-tenant proof tests, feature flag
- **Phase 3 - Auth**: Real registration with Better Auth integration, server-side validation for invite codes/payment, strategy registry, hardened auth config, session telemetry, disposable email policy from config
- **Phase 4 - API**: Better Auth HTTP surface mounted, thin routes with service layer, multi-tenancy with membership/RBAC, middleware pipeline (CORS, security headers, rate limiting), health/shutdown/RLS boot checks, full CRUD with idempotency and ETags, OpenAPI 3.1 at `/api/v1` with Swagger UI, GraphQL layer over CRM
- **Phase 5 - Project Complete**: CI/CD with migrations and security checks, Docker/Docker Compose, CD workflows, improved testing strategy, comprehensive docs (README, CONTRIBUTING, SECURITY), observability groundwork
