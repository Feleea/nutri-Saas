-- Isolamento entre tenants e separação painel-do-dono x dados clínicos.
-- Idempotente: pode rodar a cada migração (npm run db:rls).
-- Pré-requisito: papéis suasnutri_app e suasnutri_admin (docker/init-roles.sql).
-- IMPORTANTE: a aplicação NUNCA conecta como dono do schema (o dono ignora o RLS).

-- Contexto do tenant, definido por requisição: set_config('app.account_id', ..., true)
CREATE OR REPLACE FUNCTION app_account_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.account_id', true), '') $$;

-- ───────────── Permissões explícitas (lista de permitidos) ─────────────
GRANT USAGE ON SCHEMA public TO suasnutri_app, suasnutri_admin;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM suasnutri_app, suasnutri_admin;

-- Aplicação (nutricionistas)
GRANT SELECT, INSERT, UPDATE         ON "Account", "User"                      TO suasnutri_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Unit", "Patient", "Membership",
                                        "TermsAcceptance", "Food",
                                        "HouseholdMeasure"                      TO suasnutri_app;
GRANT SELECT                         ON "Plan", "FoodTable", "Subscription",
                                        "UsageCounter"                          TO suasnutri_app;
GRANT SELECT, INSERT                 ON "AuditLog"                              TO suasnutri_app;

-- Painel do dono: só conta, cobrança, contadores e a própria auditoria.
-- Sem nenhuma permissão em Patient, Unit, Membership, User, Food, AuditLog etc.
GRANT SELECT, UPDATE                 ON "Account"                               TO suasnutri_admin;
GRANT SELECT, INSERT, UPDATE         ON "Plan", "Subscription"                  TO suasnutri_admin;
GRANT SELECT                         ON "UsageCounter", "PlatformAdmin"         TO suasnutri_admin;
GRANT SELECT, INSERT                 ON "AdminAuditLog"                         TO suasnutri_admin;

-- Tentativas de login sem vínculo com tenant, identidade ou e-mail. Escrita somente
-- pela função estreita abaixo; os papéis não podem consultar nem inserir diretamente.
ALTER TABLE "AuthAuditLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_audit_insert ON "AuthAuditLog";

CREATE OR REPLACE FUNCTION append_auth_audit(p_action text, p_source_ip text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_action NOT IN ('USER_LOGIN_FAILED', 'ADMIN_LOGIN_FAILED') THEN
    RAISE EXCEPTION 'tipo de auditoria inválido';
  END IF;
  IF p_source_ip <> 'unknown' THEN
    PERFORM p_source_ip::inet;
  END IF;
  INSERT INTO public."AuthAuditLog" ("id", "action", "sourceIp")
  VALUES ('aud_' || replace(gen_random_uuid()::text, '-', ''), p_action, p_source_ip);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION append_auth_audit(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION append_auth_audit(text, text) TO suasnutri_app, suasnutri_admin;

-- ───────────── RLS: tabelas com accountId obrigatório ─────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Unit','Patient','Membership','TermsAcceptance','AuditLog'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I TO suasnutri_app
      USING ("accountId" = app_account_id())
      WITH CHECK ("accountId" = app_account_id())$p$, t);
  END LOOP;
END $$;

-- Account: o tenant só enxerga/edita a própria conta; o admin enxerga todas.
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Account";
CREATE POLICY tenant_isolation ON "Account" TO suasnutri_app
  USING (id = app_account_id()) WITH CHECK (id = app_account_id());
DROP POLICY IF EXISTS admin_all ON "Account";
CREATE POLICY admin_all ON "Account" TO suasnutri_admin USING (true) WITH CHECK (true);

-- Subscription e UsageCounter: tenant só lê o próprio; admin lê todos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Subscription','UsageCounter'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_read ON %I', t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO suasnutri_app USING ("accountId" = app_account_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON %I', t);
    EXECUTE format('CREATE POLICY admin_all ON %I TO suasnutri_admin USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Food: global (accountId nulo) legível por todos; escrita só no próprio tenant.
ALTER TABLE "Food" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS food_read ON "Food";
CREATE POLICY food_read ON "Food" FOR SELECT TO suasnutri_app
  USING ("accountId" IS NULL OR "accountId" = app_account_id());
DROP POLICY IF EXISTS food_write ON "Food";
CREATE POLICY food_write ON "Food" FOR ALL TO suasnutri_app
  USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id());

ALTER TABLE "HouseholdMeasure" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS measure_read ON "HouseholdMeasure";
CREATE POLICY measure_read ON "HouseholdMeasure" FOR SELECT TO suasnutri_app
  USING (EXISTS (SELECT 1 FROM "Food" f WHERE f.id = "foodId"
                 AND (f."accountId" IS NULL OR f."accountId" = app_account_id())));
DROP POLICY IF EXISTS measure_write ON "HouseholdMeasure";
CREATE POLICY measure_write ON "HouseholdMeasure" FOR ALL TO suasnutri_app
  USING (EXISTS (SELECT 1 FROM "Food" f WHERE f.id = "foodId" AND f."accountId" = app_account_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "Food" f WHERE f.id = "foodId" AND f."accountId" = app_account_id()));

-- ───────────── Auditoria imutável ─────────────
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'registro de auditoria é imutável'; END $$;

DROP TRIGGER IF EXISTS audit_immutable ON "AuditLog";
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

DROP TRIGGER IF EXISTS admin_audit_immutable ON "AdminAuditLog";
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

DROP TRIGGER IF EXISTS auth_audit_immutable ON "AuthAuditLog";
CREATE TRIGGER auth_audit_immutable BEFORE UPDATE OR DELETE ON "AuthAuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ───────────── Contadores de uso (US-ADM-03) ─────────────
-- SECURITY DEFINER: roda com o dono, conta registros e grava só números.
-- O admin executa a função sem nunca ter permissão de leitura em "Patient".
CREATE OR REPLACE FUNCTION refresh_usage_counters() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO "UsageCounter" (id, "accountId", date, "patientsTotal", "patientsActive", users, "storageBytes", "computedAt")
  SELECT gen_random_uuid()::text, a.id, current_date,
    (SELECT count(*) FROM "Patient" p
       WHERE p."accountId" = a.id AND p.status = 'ACTIVE')::int,
    (SELECT count(*) FROM "Patient" p
       WHERE p."accountId" = a.id AND p.status = 'ACTIVE'
         AND p."lastActivityAt" >= now() - make_interval(days => COALESCE(pl."activePatientDays", 90)))::int,
    (SELECT count(*) FROM "Membership" m WHERE m."accountId" = a.id)::int,
    0, now()
  FROM "Account" a
  LEFT JOIN "Subscription" s ON s."accountId" = a.id
  LEFT JOIN "Plan" pl ON pl.id = s."planId"
  ON CONFLICT ("accountId", date) DO UPDATE SET
    "patientsTotal"  = EXCLUDED."patientsTotal",
    "patientsActive" = EXCLUDED."patientsActive",
    users            = EXCLUDED.users,
    "storageBytes"   = EXCLUDED."storageBytes",
    "computedAt"     = EXCLUDED."computedAt";
END $$;

REVOKE ALL ON FUNCTION refresh_usage_counters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_usage_counters() TO suasnutri_admin;
