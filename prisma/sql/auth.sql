-- Funções de autenticação (SECURITY DEFINER). Idempotente.
-- Cadastro e login acontecem ANTES de existir um tenant no contexto, então
-- precisam de caminhos controlados que contornem o RLS de forma estreita.

-- Cria conta + unidade padrão + titular + assinatura de trial + aceites, atomicamente.
-- Retorna zero linhas se o e-mail já existir (a aplicação responde de forma neutra).
CREATE OR REPLACE FUNCTION signup_create_tenant(
  p_account_name text, p_email text, p_user_name text, p_password_hash text,
  p_trial_plan_code text, p_terms_version text, p_trial_days int
) RETURNS TABLE(account_id text, user_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_acc  text := 'acc_'  || replace(gen_random_uuid()::text, '-', '');
  v_user text := 'usr_'  || replace(gen_random_uuid()::text, '-', '');
  v_plan text;
  v_kind text;
BEGIN
  SELECT id INTO v_plan FROM "Plan" WHERE code = p_trial_plan_code AND active;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'plano de trial inexistente'; END IF;

  INSERT INTO "User" (id, email, "passwordHash", name)
  VALUES (v_user, lower(p_email), p_password_hash, p_user_name)
  ON CONFLICT (email) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO "Account" (id, name, email, status, "trialEndsAt")
  VALUES (v_acc, p_account_name, lower(p_email), 'TRIAL', now() + make_interval(days => p_trial_days));

  INSERT INTO "Unit" (id, "accountId", name, "isDefault")
  VALUES ('unt_' || replace(gen_random_uuid()::text, '-', ''), v_acc, 'Unidade principal', true);

  INSERT INTO "Membership" (id, "accountId", "userId", role)
  VALUES ('mem_' || replace(gen_random_uuid()::text, '-', ''), v_acc, v_user, 'TITULAR');

  INSERT INTO "Subscription" (id, "accountId", "planId", status, "currentPeriodEnd")
  VALUES ('sub_' || replace(gen_random_uuid()::text, '-', ''), v_acc, v_plan, 'TRIAL',
          now() + make_interval(days => p_trial_days));

  FOREACH v_kind IN ARRAY ARRAY['TERMS','PRIVACY','DPA'] LOOP
    INSERT INTO "TermsAcceptance" (id, "accountId", "userId", kind, version)
    VALUES ('tac_' || replace(gen_random_uuid()::text, '-', ''), v_acc, v_user, v_kind, p_terms_version);
  END LOOP;

  INSERT INTO "AuditLog" (id, "accountId", "actorUserId", action, resource, "resourceId")
  VALUES ('aud_' || replace(gen_random_uuid()::text, '-', ''), v_acc, v_user, 'SIGNUP', 'Account', v_acc);

  RETURN QUERY SELECT v_acc, v_user;
END $$;

-- Vínculos de um usuário (o login precisa disto antes de saber o tenant).
CREATE OR REPLACE FUNCTION auth_memberships(p_user_id text)
RETURNS TABLE(account_id text, role text, unit_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT "accountId", role::text, "unitId" FROM "Membership"
  WHERE "userId" = p_user_id ORDER BY "createdAt"
$$;

REVOKE ALL ON FUNCTION signup_create_tenant(text,text,text,text,text,text,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signup_create_tenant(text,text,text,text,text,text,int) TO suasnutri_app;
GRANT EXECUTE ON FUNCTION auth_memberships(text) TO suasnutri_app;

-- Sessões e tokens: acessados pelo hash do token, antes do contexto de tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Session", "EmailToken" TO suasnutri_app;

-- E-mails dos titulares das contas do usuário (avisos de bloqueio e troca de senha).
CREATE OR REPLACE FUNCTION auth_titular_emails(p_user_id text)
RETURNS TABLE(email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT u.email
  FROM "Membership" mu
  JOIN "Membership" mt ON mt."accountId" = mu."accountId" AND mt.role = 'TITULAR'
  JOIN "User" u ON u.id = mt."userId"
  WHERE mu."userId" = p_user_id
$$;
REVOKE ALL ON FUNCTION auth_titular_emails(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_titular_emails(text) TO suasnutri_app;

-- 2FA: códigos de recuperação (aplicação) e sessões/tentativas do super-admin (painel).
GRANT SELECT, INSERT, UPDATE, DELETE ON "RecoveryCode" TO suasnutri_app;
GRANT SELECT, INSERT, UPDATE ON "AdminSession" TO suasnutri_admin;
GRANT UPDATE ("totpLastStep", "failedLogins", "lockedUntil") ON "PlatformAdmin" TO suasnutri_admin;

-- ───────────── Convites de equipe (US-AUT-05) ─────────────
-- O convidado ainda não tem tenant no contexto: consulta e aceite passam por funções.
CREATE OR REPLACE FUNCTION invitation_peek(p_token_hash text, p_now timestamptz)
RETURNS TABLE(invitation_id text, account_id text, email text, role text, user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i."accountId", i.email, i.role::text, u.id
  FROM "Invitation" i LEFT JOIN "User" u ON u.email = i.email
  WHERE i."tokenHash" = p_token_hash AND i."acceptedAt" IS NULL
    AND i."revokedAt" IS NULL AND i."expiresAt" > p_now
$$;

-- Conta, papel e e-mail vêm SEMPRE do convite, nunca do chamador: o convidado só entra
-- no tenant que o convidou, com o papel definido. Retorna NULL se o convite não for válido.
CREATE OR REPLACE FUNCTION invitation_accept(
  p_token_hash text, p_now timestamptz, p_user_id text,
  p_user_name text, p_password_hash text, p_terms_version text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv "Invitation"%ROWTYPE;
  v_limit int;
  v_count int;
  v_user text := p_user_id;
  v_kind text;
BEGIN
  SELECT * INTO inv FROM "Invitation"
   WHERE "tokenHash" = p_token_hash AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > p_now
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE id = v_user AND email = inv.email) THEN
    RETURN NULL;
  END IF;

  SELECT p."userLimit" INTO v_limit FROM "Subscription" s JOIN "Plan" p ON p.id = s."planId"
   WHERE s."accountId" = inv."accountId";
  SELECT count(*) INTO v_count FROM "Membership" WHERE "accountId" = inv."accountId";
  IF v_limit IS NOT NULL AND v_count >= v_limit THEN RAISE EXCEPTION 'user_limit'; END IF;

  IF v_user IS NULL THEN
    v_user := 'usr_' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO "User" (id, email, "passwordHash", name, "emailVerifiedAt")
    VALUES (v_user, inv.email, p_password_hash, p_user_name, p_now); -- e-mail provado pelo convite
    FOREACH v_kind IN ARRAY ARRAY['TERMS','PRIVACY','DPA'] LOOP
      INSERT INTO "TermsAcceptance" (id, "accountId", "userId", kind, version, "acceptedAt")
      VALUES ('tac_' || replace(gen_random_uuid()::text, '-', ''), inv."accountId", v_user, v_kind, p_terms_version, p_now);
    END LOOP;
  END IF;

  INSERT INTO "Membership" (id, "accountId", "userId", role)
  VALUES ('mem_' || replace(gen_random_uuid()::text, '-', ''), inv."accountId", v_user, inv.role)
  ON CONFLICT ("accountId", "userId") DO NOTHING;

  UPDATE "Invitation" SET "acceptedAt" = p_now WHERE id = inv.id;

  INSERT INTO "AuditLog" (id, "accountId", "actorUserId", action, resource, "resourceId")
  VALUES ('aud_' || replace(gen_random_uuid()::text, '-', ''), inv."accountId", v_user, 'INVITE_ACCEPTED', 'Invitation', inv.id);

  RETURN inv."accountId";
END $$;

REVOKE ALL ON FUNCTION invitation_peek(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION invitation_accept(text, timestamptz, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_peek(text, timestamptz) TO suasnutri_app;
GRANT EXECUTE ON FUNCTION invitation_accept(text, timestamptz, text, text, text, text) TO suasnutri_app;
