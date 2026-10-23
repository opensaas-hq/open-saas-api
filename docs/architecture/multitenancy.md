# Multi-tenancy isolation model

This document describes how tenant isolation is enforced in Open SaaS API: the
layers involved, what each one guarantees, and — just as importantly — what the
model does **not** cover. It is the reference for contributors (see the
contributor rule below) and the record of the Row-Level Security (RLS)
decision introduced in Phase 2.5.

## Layers

Isolation is defence in depth. A request crosses four layers, each of which
narrows what data can be touched:

| Layer | Mechanism | Guarantee | Enforced today |
| --- | --- | --- | --- |
| Route | `organizationId` always comes from the resolved tenant, never from the request body | A caller cannot name another tenant's id as a parameter | Partially (route layer is rewritten in §4.3) |
| Tenant middleware | Requires a session and an `activeOrganizationId`; injects `tenant = { organizationId, branchId }` | No authenticated tenant context, no tenant-scoped query | Partially (§4.3) |
| Repository | Every query carries `WHERE organization_id = $1`; `organizationId` is required at the type level | Application-level scoping; a missing tenant is a compile error | Yes (Phase 2) |
| Database (RLS) | `ENABLE` + `FORCE ROW LEVEL SECURITY` on the business tables; a `tenant_isolation` policy keyed on the `app.current_org` GUC | Even a query that forgets `WHERE` cannot read or write another tenant's rows | Yes (Phase 2.5, behind `RLS_ENABLED`) |

The first three layers protect against *application* mistakes. RLS is the last
line: it protects against a query builder that drops a filter, a new code path
that forgets the scope, or a raw SQL statement.

## Row-Level Security (Phase 2.5)

### Scope

RLS is enabled on the **business tables only**:

- `contacts`
- `branches`
- `audit_log`

Better Auth's seven tables (`user`, `session`, `account`, `verification`,
`organization`, `member`, `invitation`) are **framework-owned** and queried by
the framework without a tenant GUC (e.g. a session looked up by token before any
tenant is known). Enabling RLS on them is a separate decision and is **not** part
of this model — see "Limits" below.

### How it works

- **Two roles.** DDL and migrations run as the table **owner** (the role in the
  migration `DATABASE_URL`). The runtime connects as a dedicated login role,
  `opensaas_app`, which is not a superuser, has no `BYPASSRLS`, and owns
  nothing. Because the owner bypasses RLS by default, the tables use
  `FORCE ROW LEVEL SECURITY` so the owner is bound by the policies too.
- **The policy** on each business table is:

  ```sql
  USING      (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true))
  ```

  `USING` limits visibility (reads, and the rows `UPDATE`/`DELETE` may target);
  `WITH CHECK` limits writability (inserts and the new row of an update).
- **The GUC.** `app.current_org` is set transaction-locally with
  `set_config('app.current_org', $1, true)` as the first statement of every
  tenant-scoped transaction (`withTransaction`, and the single-operation
  `runInTenantContext` helper in `packages/database`). Because it is
  transaction-local, the value never leaks onto the pooled connection.
- **Deny by default.** With the GUC unset, `current_setting('app.current_org',
  true)` is `NULL` and `organization_id = NULL` is never true, so the query
  returns zero rows and a write is rejected. There is no permissive fallback.
- **The flag.** `RLS_ENABLED` (validated in `envSchema`, default `false`) is a
  **runtime behavioral switch**, not a migration gate: when on, the client
  assumes the `opensaas_app` role and the tenant GUC is set; when off, RLS is
  not enforced and behaviour is identical to pre-RLS. It is off in local
  development until the application-layer adoption (§4.3/§4.4) is complete, and
  on in the dedicated RLS CI job.

### Bootstrap, not a migration

There is **no released schema yet**, so there is nothing to migrate. The RLS
bootstrap ships as an idempotent SQL script,
`packages/database/sql/rls-setup.sql` (with `rls-teardown.sql` to reset a test
database), applied explicitly via `bun --filter @opensaas/database db:rls:test`.
Once a deployment target and migration workflow exist (§5.1/§5.5), this becomes
a proper, committed enabling migration with a rollback; until then it is
deliberately kept out of the Drizzle journal.

## Guarantees

- A connection using the application role that omits `organization_id` sees
  **only** the current tenant's rows (or none), never another tenant's.
- A cross-tenant insert is rejected by `WITH CHECK`; an unfiltered
  `UPDATE`/`DELETE` touches only the current tenant's rows.
- The owner/migration role can still administer the tables (DDL), but is bound
  by the policies for data access.
- The proof suite (`packages/database/src/__tests__/rls.test.ts`) asserts
  `rowsecurity = true` at start, so a silently disabled setup fails rather than
  passing vacuously.

## Limits — what this model does not cover

- **Better Auth's seven tables.** Framework-owned; RLS would break the
  framework's own tenant-less lookups (a session by token, an account by
  provider id). Their isolation relies on application rules, not the database.
- **RBAC.** Roles (`owner`/`admin`/`member`) are an HTTP-layer concern (§4.3).
  RLS scopes by tenant, not by role within a tenant.
- **Branch ownership.** `branchId` must still be verified against the caller's
  organization at the application layer; RLS protects the tenant boundary, not
  the branch boundary.
- **Superuser connections.** A connection that authenticates as a superuser
  bypasses RLS regardless of `FORCE`. The runtime must connect as
  `opensaas_app` for the guarantees to hold — that is what `RLS_ENABLED`
  switches on.

## Contributor rule

If your change adds a tenant-scoped query, the `organizationId` filter is
non-negotiable, **and** the query must run inside a tenant-scoped transaction so
the GUC is set. Use `withTransaction`/`runInTenantContext`; never query a
business table from a raw connection or an unscoped transaction. Any id that
comes from the client (`branchId` in particular) must be verified against the
caller's organization before use.
