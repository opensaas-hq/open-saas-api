# ADR 0001 — Row-Level Security as the second line of defense

- **Status:** Accepted
- **Date:** 2026-10-20
- **Phase:** 2.5
- **Refs:** `docs/v4/roadmap.md` §2.5, `docs/architecture/multitenancy.md`,
  `docs/v3/architecture.md` §10.2.

## Context

Application-level scoping (`WHERE organization_id = …`) was the only isolation
mechanism. The audit trail (docs/v2/analysis.md §3.7) showed that scoping lives
only in route/repository code, so a single forgotten filter — a buggy query
builder, a new code path, a raw statement — leaks another tenant's data. The
database itself did not refuse cross-tenant access.

## Decision

Adopt Postgres **Row-Level Security** as a second line of defense on the
**business tables only** (`contacts`, `branches`, `audit_log`):

- A dedicated runtime role `opensaas_app` (no superuser, no `BYPASSRLS`, no
  ownership); DDL/migrations run as the owner.
- Policies keyed on the transaction-local GUC `app.current_org`, identical in
  `USING` and `WITH CHECK`, so a row can neither be read nor written outside the
  caller's tenant.
- `ENABLE` + `FORCE ROW LEVEL SECURITY`, so the owner is bound too.
- Deny by default: an unset GUC yields zero rows.
- `RLS_ENABLED` (validated env, default off) is the runtime behavioral switch;
  the bootstrap ships as an idempotent SQL script, not a migration, because
  there is no released schema yet.

Better Auth's seven tables are deliberately **out of scope**: the framework
queries them without tenant context (e.g. a session by token), and reshaping or
guarding them is a separate decision.

## Consequences

- **Positive:** cross-tenant access fails at the database even when application
  code forgets the filter; the `app.current_org` GUC makes the runtime match the
  type-level `organizationId` guarantee.
- **Negative / costs:** every tenant-scoped call must run inside a tenant
  transaction to set the GUC (a new failure mode: typed `TenantContextError`
  instead of a silent unscoped query); the owner/admin path needs `FORCE`; the
  bootstrap is not yet in the migration journal.
- **Neutral:** RLS complements, and does not replace, the application-layer
  rules (membership, RBAC, branch ownership) — see the limits in
  `docs/architecture/multitenancy.md`.
