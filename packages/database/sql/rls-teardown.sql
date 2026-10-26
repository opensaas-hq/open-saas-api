-- Tear down the Row-Level Security bootstrap (§2.5).
--
-- Used to reset the test database between RLS test runs so results are
-- reproducible. This is NOT a production rollback migration (none exists yet):
-- there is nothing deployed to roll back. See docs/architecture/multitenancy.md.
--
-- Safe to run repeatedly.

DROP POLICY IF EXISTS tenant_isolation ON contacts;
DROP POLICY IF EXISTS tenant_isolation ON branches;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;

ALTER TABLE contacts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE branches NO FORCE ROW LEVEL SECURITY;
ALTER TABLE branches DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM opensaas_app;
REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM opensaas_app;
REVOKE USAGE ON SCHEMA public FROM opensaas_app;

-- The default privileges granted by the setup must be revoked too, or a role
-- created later would silently inherit them again.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM opensaas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM opensaas_app;

-- Drop the role only if it owns nothing and has no dependent objects.
DROP ROLE IF EXISTS opensaas_app;
