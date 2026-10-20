-- Row-Level Security bootstrap for the business tables (§2.5).
--
-- This is NOT a Drizzle migration: there is no released schema yet, so there is
-- nothing to migrate. It is an idempotent script applied by the RLS test job
-- (and, later, by an explicit deployment step) to enable the database-level
-- second line of defense on `contacts`, `branches` and `audit_log`.
--
-- Model:
--   * `opensaas_app`  - runtime login role. No superuser, no BYPASSRLS, owns
--                       nothing, so RLS applies to every one of its queries.
--   * table owner     - DDL/migrations run as the owner (e.g. `admin`), which
--                       bypasses RLS unless FORCE is set. We set FORCE so the
--                       owner is bound by the policies too.
--
-- Deny by default: `current_setting('app.current_org', true)` is NULL when the
-- GUC is unset, and `organization_id = NULL` is never true, so an unset GUC
-- yields zero rows. The runtime sets the GUC per transaction (§2.5.2).
--
-- Safe to run repeatedly: role creation and policy creation are guarded.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opensaas_app') THEN
    CREATE ROLE opensaas_app LOGIN;
  END IF;
END
$$;

-- Ensure the role can never bypass RLS, even if it is re-created by hand.
ALTER ROLE opensaas_app NOSUPERUSER NOBYPASSRLS;

-- The app role needs to see the schema and run DML on the business tables.
-- It is deliberately granted no DDL and no ownership.
GRANT USAGE ON SCHEMA public TO opensaas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  contacts,
  branches,
  audit_log
TO opensaas_app;

-- Enable and FORCE RLS so the owner is bound by the policies as well.
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Policies: read and write are both limited to the current tenant. The
-- predicate is identical in USING (visibility) and WITH CHECK (writability),
-- so a row can neither be read nor written outside the caller's organization.
DROP POLICY IF EXISTS tenant_isolation ON contacts;
CREATE POLICY tenant_isolation ON contacts
  USING (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS tenant_isolation ON branches;
CREATE POLICY tenant_isolation ON branches
  USING (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));
