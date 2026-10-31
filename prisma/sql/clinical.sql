-- Clinical records: tenant-only access. The admin role receives no clinical grants.
GRANT SELECT, INSERT, UPDATE ON "AnamnesisTemplate" TO suasnutri_app;
GRANT SELECT, INSERT ON "AnamnesisTemplateVersion" TO suasnutri_app;
GRANT SELECT, INSERT, UPDATE ON "AnamnesisRecord" TO suasnutri_app;
GRANT SELECT, INSERT ON "AnthropometryRecord" TO suasnutri_app;
GRANT SELECT, INSERT, UPDATE ON "TenantDataEncryptionKey" TO suasnutri_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'AnamnesisTemplate', 'AnamnesisTemplateVersion',
    'AnamnesisRecord', 'AnthropometryRecord', 'TenantDataEncryptionKey'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I TO suasnutri_app
      USING ("accountId" = app_account_id())
      WITH CHECK ("accountId" = app_account_id())$policy$, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION forbid_clinical_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'registro clínico imutável'; END $$;

CREATE OR REPLACE FUNCTION protect_anthropometry() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."clinicalDataCiphertext" IS NULL
     AND NEW."clinicalDataCiphertext" IS NOT NULL
     AND NEW."id" = OLD."id"
     AND NEW."accountId" = OLD."accountId"
     AND NEW."patientId" = OLD."patientId"
     AND NEW."createdByUserId" = OLD."createdByUserId"
     AND NEW."createdAt" = OLD."createdAt"
     AND NEW."measuredAt" IS NULL
     AND NEW."weightKg" IS NULL
     AND NEW."heightCm" IS NULL
     AND NEW."bmi" IS NULL
     AND NEW."waistCm" IS NULL
     AND NEW."hipCm" IS NULL
     AND NEW."neckCm" IS NULL
     AND NEW."armCm" IS NULL
     AND NEW."thighCm" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'registro clínico imutável';
END $$;

DROP TRIGGER IF EXISTS anamnesis_version_immutable ON "AnamnesisTemplateVersion";
CREATE TRIGGER anamnesis_version_immutable
  BEFORE UPDATE ON "AnamnesisTemplateVersion"
  FOR EACH ROW EXECUTE FUNCTION forbid_clinical_mutation();

DROP TRIGGER IF EXISTS anthropometry_immutable ON "AnthropometryRecord";
CREATE TRIGGER anthropometry_immutable
  BEFORE UPDATE ON "AnthropometryRecord"
  FOR EACH ROW EXECUTE FUNCTION protect_anthropometry();
