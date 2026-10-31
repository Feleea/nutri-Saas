-- Agenda e lembretes. Idempotente. Rodar depois dos demais scripts.
GRANT SELECT, INSERT, UPDATE ON "Appointment", "Reminder" TO suasnutri_app;
GRANT SELECT, INSERT ON "AppointmentHistory" TO suasnutri_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Appointment','AppointmentHistory','Reminder'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I TO suasnutri_app
      USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id())$p$, t);
  END LOOP;
END $$;

-- O job de lembretes roda sem tenant no contexto: esta função só devolve QUAIS contas têm lembretes
-- vencidos (ids), nunca dados de pacientes. O trabalho em si roda por conta, com RLS.
CREATE OR REPLACE FUNCTION reminders_due_accounts(p_now timestamptz)
RETURNS TABLE(account_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT "accountId" FROM "Reminder"
  WHERE status IN ('PENDING', 'SENDING') AND "sendAt" <= p_now
$$;
REVOKE ALL ON FUNCTION reminders_due_accounts(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reminders_due_accounts(timestamptz) TO suasnutri_app;
