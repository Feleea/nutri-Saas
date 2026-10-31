-- Busca de alimentos e tabelas de LGPD. Idempotente. Rodar depois de rls.sql, auth.sql e billing.sql.

-- Busca por trecho em até 300 ms mesmo com TACO + TBCA (milhares de linhas).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS food_name_trgm ON "Food" USING gin ("normalizedName" gin_trgm_ops);

-- Exportações: só o próprio tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON "DataExport" TO suasnutri_app;
ALTER TABLE "DataExport" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DataExport";
CREATE POLICY tenant_isolation ON "DataExport" TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());

-- Registro de exclusões: o tenant grava e lê; ninguém edita nem apaga pela aplicação.
GRANT SELECT, INSERT ON "DeletionLedger" TO suasnutri_app;
ALTER TABLE "DeletionLedger" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeletionLedger";
CREATE POLICY tenant_isolation ON "DeletionLedger" TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());

-- Composição de receitas: leitura e criação limitadas ao tenant.
GRANT SELECT, INSERT ON "RecipeIngredient" TO suasnutri_app;
ALTER TABLE "RecipeIngredient" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RecipeIngredient";
CREATE POLICY tenant_isolation ON "RecipeIngredient" TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());
