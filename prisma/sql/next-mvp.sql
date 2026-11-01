-- Shared foundation for follow-up MVP modules. Clinical data is available only
-- to the tenant application role; the platform-admin role receives no access.
REVOKE ALL ON TABLE
  "PatientConsultationPackage", "PackageSession",
  "AppointmentAvailabilityRule", "AppointmentBlock",
  "PatientAttachment", "PatientPortalSession"
FROM PUBLIC, suasnutri_app, suasnutri_admin;

GRANT SELECT, INSERT, UPDATE ON "PatientConsultationPackage" TO suasnutri_app;
GRANT SELECT, INSERT ON "PackageSession" TO suasnutri_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "AppointmentAvailabilityRule", "AppointmentBlock" TO suasnutri_app;
GRANT SELECT, INSERT, DELETE ON "PatientAttachment" TO suasnutri_app;
GRANT SELECT, INSERT, UPDATE ON "PatientPortalSession" TO suasnutri_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'PatientConsultationPackage', 'PackageSession',
    'AppointmentAvailabilityRule', 'AppointmentBlock',
    'PatientAttachment', 'PatientPortalSession'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I TO suasnutri_app
      USING ("accountId" = app_account_id())
      WITH CHECK ("accountId" = app_account_id())$policy$, t);
  END LOOP;
END $$;
