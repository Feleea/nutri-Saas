-- Fase 1: pacientes. Idempotente. Rodar depois dos demais scripts.

-- Busca por trecho do nome (US-PAC-02) mesmo com centenas de pacientes por tenant.
CREATE INDEX IF NOT EXISTS patient_name_trgm ON "Patient" USING gin ("normalizedName" gin_trgm_ops);

-- Consentimentos: o tenant grava e atualiza (revogação); a exclusão do paciente remove em cascata.
GRANT SELECT, INSERT, UPDATE ON "PatientConsent" TO suasnutri_app;
ALTER TABLE "PatientConsent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PatientConsent";
CREATE POLICY tenant_isolation ON "PatientConsent" TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());

-- Avisos da plataforma.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Notice" TO suasnutri_app;
ALTER TABLE "Notice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notice";
CREATE POLICY tenant_isolation ON "Notice" TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());
