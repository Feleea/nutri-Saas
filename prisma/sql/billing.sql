-- Permissões e RLS das tabelas de equipe e cobrança. Idempotente. Rodar depois de rls.sql e auth.sql.

-- Convites: só o próprio tenant (aceite via função SECURITY DEFINER).
GRANT SELECT, INSERT, UPDATE, DELETE ON "Invitation" TO suasnutri_app;
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invitation";
CREATE POLICY tenant_isolation ON "Invitation" TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());

-- Faturas: o tenant lê as próprias; o painel do dono lê e grava (via webhook/serviço de cobrança).
GRANT SELECT ON "Invoice" TO suasnutri_app;
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_read ON "Invoice";
CREATE POLICY tenant_read ON "Invoice" FOR SELECT TO suasnutri_app USING ("accountId" = app_account_id());
DROP POLICY IF EXISTS admin_all ON "Invoice";
CREATE POLICY admin_all ON "Invoice" TO suasnutri_admin USING (true) WITH CHECK (true);

-- Eventos de pagamento e linha do tempo: só o painel (a aplicação não tem permissão).
GRANT SELECT, INSERT, UPDATE ON "Invoice", "PaymentEvent", "TenantEvent" TO suasnutri_admin;
