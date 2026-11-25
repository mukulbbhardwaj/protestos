-- Tenant isolation backstop (BUILD_PLAN 6.3, ADR 003).
--
-- Org-scoped queries run inside a transaction that does
--   SET LOCAL ROLE app_tenant;  SELECT set_config('app.current_org_id', '<id>', true);
-- app_tenant is not the table owner and not a superuser, so the policies below apply.
-- System code (auth, onboarding, the worker) runs as the connecting role and is unaffected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN;
  END IF;
END
$$;

GRANT app_tenant TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;

-- Platform tables tenant code never touches.
REVOKE ALL ON "Session", "AuthToken" FROM app_tenant;
DO $$
BEGIN
  -- Absent in Prisma's shadow database.
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM app_tenant;
  END IF;
END
$$;
-- Tenant code may read its own org and members, but not create or delete orgs or users.
REVOKE INSERT, DELETE ON "Org" FROM app_tenant;
REVOKE INSERT, UPDATE, DELETE ON "User" FROM app_tenant;
-- The audit log is append-only.
REVOKE UPDATE, DELETE ON "AuditLog" FROM app_tenant;

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS integer
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_org_id', true), '')::integer $$;

-- Org: only the current org is visible.
ALTER TABLE "Org" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Org"
  USING ("id" = app_current_org_id())
  WITH CHECK ("id" = app_current_org_id());

-- User: only users who are members of the current org are visible.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING (EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = "User"."id" AND m."orgId" = app_current_org_id()
  ));

-- Every table with an orgId column. tenant-tables.test.ts fails if one is missing.
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invitation"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "OrgSetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgSetting"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("orgId" = app_current_org_id()) WITH CHECK ("orgId" = app_current_org_id());
