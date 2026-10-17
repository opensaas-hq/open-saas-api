# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - Unreleased / Initial MVP Core

### Added
- **Monorepo Architecture (Phase 1):** Configured Bun Workspaces (`packages/*` and `apps/api`), Biome linter/formatter, Zod environment validation (`@opensaas/core`), standard error handling system (`AppError`), and health check routes.
- **Auth & Telemetry (Phase 2):** Integrated Better Auth with Drizzle ORM PostgreSQL schema. Added session telemetry, device fingerprinting, and real IP extraction supporting Cloudflare and reverse proxies.
- **Multi-Tenancy & CRM:** Organization context, member roles, and branch-level tenant isolation middleware in Hono. Implemented Base CRM `/api/contacts` routes (individual creation, organization-isolated listing with pagination/search, opt-in consent, and bulk import).
- **Quality & Isolation:** Global HTTP error interceptor, structured Pino logger, and comprehensive testing suite with 26 passing unit/integration tests running via `bun test`.
