# Multi-Tenancy and Authorization

> Part of the [Open SaaS API documentation](../README.md). Section numbers are kept from the original architecture guide for traceability.

## 10. Multi-Tenancy and Authorization

Tenant isolation has two independent layers.

### 10.1 Layer 1 — application tenancy

- Tenant id always comes from `session.activeOrganizationId`.
- Every tenant route runs `tenantContextMiddleware`.
- Membership is checked against the `member` table (through cache).
- Every branch reference is validated against the tenant.
- Every repository query for tenant-owned data includes `organization_id` in the
  `WHERE`, in addition to any id filter.
- Cross-tenant ids are reported as 404, not 403, to avoid confirming existence.
- The tenant context is passed explicitly into services as `organizationId`.

No route accepts an `organizationId` from the request body.

### 10.2 Layer 2 — PostgreSQL RLS

RLS applies only to:

- `contacts`
- `branches`
- `audit_log`

The `rls-setup.sql` script:

- Creates `opensaas_app` with `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`.
- Grants schema usage and DML on all tables/sequences.
- Sets default privileges for future tables.
- Enables and **forces** RLS on the three tables.
- Creates a `tenant_isolation` policy on each:
  - `USING organization_id = current_setting('app.current_org', true)`
  - `WITH CHECK organization_id = current_setting('app.current_org', true)`

An unset GUC yields `NULL`; the comparison is never true, so the default is
deny-by-zero-rows.

When `RLS_ENABLED=true`:

- `createDb()` connects with the `role` startup parameter set to `opensaas_app`.
- `withTransaction()` / `runInTenantContext()` set the transaction-local GUC
  with `set_config('app.current_org', ..., true)`.
- Boot calls `assertRlsEnforcement()` and refuses to serve if any check fails.

When `RLS_ENABLED=false` (the default):

- The client does not assume the app role.
- The GUC is not set.
- RLS is not enforced even if policies exist on the tables.
- Isolation relies entirely on application `WHERE` clauses.

The RLS bootstrap is **not** a Drizzle migration. It is applied by explicit
scripts/jobs:
`db:rls:test`, `db:rls:test:down`, `db:rls:dev`, `db:rls:dev:down`.

### 10.3 Permission matrix

Defined once in `apps/api/src/middleware/rbac.ts` and reused by REST middleware
and GraphQL resolvers:

| Permission | owner | admin | member |
| --- | --- | --- | --- |
| `contacts:read` | yes | yes | yes |
| `contacts:write` | yes | yes | yes |
| `contacts:bulk` | yes | yes | no |
| `contacts:delete` | yes | yes | no |
| `branches:read` | yes | yes | yes |
| `branches:write` | yes | yes | no |
| `members:write` | yes | no | no |

Notes:

- `members:write` exists in the matrix but has no REST/GraphQL route in this
  repository; member management is currently performed by Better Auth's
  organization plugin.
- The contacts list and create routes rely on membership only; both are allowed
  to all three roles by the matrix anyway.
- `assertRole` denies an undefined/unknown role; it never assumes a default.
- `hasPermission` is the pure predicate used by GraphQL.

### 10.4 Branch scoping

A request may carry a branch via `x-branch-id` header or `?branchId=` query.
The tenant middleware validates it and verifies ownership. Contact payloads may
also carry `branchId`; the contacts service validates every referenced branch.
A branch from another tenant is treated as not found.

### 10.5 Tenant transactions

- `runInTenantContext({ organizationId, run, tx?, db? })` runs one operation with
  the GUC set, or joins an existing transaction.
- `withTransaction({ organizationId, callback, db? })` opens one transaction with
  the GUC set.
- `withRawTransaction(callback, db?)` opens a transaction with no GUC; use only
  for non-tenant flows (registration, framework tables, migrations, probes).
- A missing or blank `organizationId` throws `TenantContextError` before SQL.

### 10.6 RLS guarantees, limits, and contributor rule

**Guarantees**

- A connection using `opensaas_app` that omits `organization_id` sees **only**
  the current tenant's rows (or none), never another tenant's.
- A cross-tenant insert is rejected by `WITH CHECK`; an unfiltered
  `UPDATE`/`DELETE` touches only the current tenant's rows.
- The owner/migration role can still administer the tables (DDL), but
  `FORCE ROW LEVEL SECURITY` binds it to the policies for data access.
- The proof suite (`packages/database/src/__tests__/rls.test.ts`) asserts
  `rowsecurity = true` at start, so a silently disabled setup fails instead of
  passing vacuously.

**Limits — what this model does not cover**

- **Better Auth's seven tables.** They are framework-owned and queried without a
  tenant GUC (for example, a session looked up by token before any tenant is
  known). Their isolation relies on application rules, not the database.
- **RBAC.** Roles (`owner`/`admin`/`member`) are an HTTP-layer concern. RLS
  scopes by tenant, not by role within a tenant.
- **Branch ownership.** `branchId` must still be verified against the caller's
  organization at the application layer; RLS protects the tenant boundary, not
  the branch boundary.
- **Superuser connections.** A connection that authenticates as a superuser
  bypasses RLS regardless of `FORCE`. The runtime must connect as
  `opensaas_app` for the guarantees to hold; that is what `RLS_ENABLED` switches
  on.

**Contributor rule**

If a change adds a tenant-scoped query, the `organizationId` filter is
non-negotiable, **and** the query must run inside a tenant-scoped transaction so
the GUC is set. Use `withTransaction`/`runInTenantContext`; never query a
business table from a raw connection or an unscoped transaction. Any id that
comes from the client (`branchId` in particular) must be verified against the
caller's organization before use.

### 10.7 Decision record: RLS as the second line of defense (ADR-0001)

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** introduced during the multi-tenancy and RLS hardening work

**Context**

Application-level scoping (`WHERE organization_id = …`) was the only isolation
mechanism. The audit trail showed that scoping lives only in route/repository
code, so a single forgotten filter (a buggy query builder, a new code path, or a
raw statement) could leak another tenant's data. The database itself did not
refuse cross-tenant access.

**Decision**

Adopt PostgreSQL **Row-Level Security** as a second line of defense on the
**business tables only** (`contacts`, `branches`, `audit_log`):

- A dedicated runtime role, `opensaas_app` (no superuser, no `BYPASSRLS`, no
  ownership); DDL and migrations run as the owner.
- Policies keyed on the transaction-local GUC `app.current_org`, identical in
  `USING` and `WITH CHECK`, so a row can neither be read nor written outside the
  caller's tenant.
- `ENABLE` + `FORCE ROW LEVEL SECURITY`, so the owner is bound too.
- Deny by default: an unset GUC yields zero rows.
- `RLS_ENABLED` (validated env, default off) is the runtime behavioral switch;
  the bootstrap ships as an idempotent SQL script, not a migration, because
  there is no released schema yet.

Better Auth's seven tables are deliberately **out of scope**: the framework
queries them without tenant context (for example, a session by token), and
guarding them is a separate decision.

**Consequences**

- **Positive:** cross-tenant access fails at the database even when application
  code forgets the filter; the `app.current_org` GUC makes the runtime match the
  type-level `organizationId` guarantee.
- **Costs:** every tenant-scoped call must run inside a tenant transaction to set
  the GUC (a new failure mode: typed `TenantContextError` instead of a silent
  unscoped query); the owner/admin path needs `FORCE`; the bootstrap is not yet
  in the migration journal.
- **Neutral:** RLS complements, and does not replace, the application-layer
  rules (membership, RBAC, branch ownership).

---

## Related

- [Authentication](authentication.md)
- [Data and services](data-and-services.md)
- [Security](security.md)
- [Development guide](../development-guide.md)
- [Technical debt](../technical-debt.md)
- [Roadmap](../roadmap.md)
