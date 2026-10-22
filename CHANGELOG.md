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
