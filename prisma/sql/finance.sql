-- Logo configuration and clinic finance. Tenant access is isolated by accountId.
GRANT SELECT, UPDATE ("logoUrl") ON "Account" TO suasnutri_app;
GRANT SELECT, INSERT ON "Charge" TO suasnutri_app;
GRANT UPDATE ("status", "paidAt") ON "Charge" TO suasnutri_app;

ALTER TABLE "Charge" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Charge";
CREATE POLICY tenant_isolation ON "Charge" TO suasnutri_app
  USING ("accountId" = app_account_id())
  WITH CHECK ("accountId" = app_account_id());
