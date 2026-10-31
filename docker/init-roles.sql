-- Papéis de execução. Nenhum é superuser nem BYPASSRLS.
-- Em produção, troque as senhas e use um gerenciador de segredos.
CREATE ROLE suasnutri_app   LOGIN PASSWORD 'app_dev_pw'   NOSUPERUSER NOBYPASSRLS;
CREATE ROLE suasnutri_admin LOGIN PASSWORD 'admin_dev_pw' NOSUPERUSER NOBYPASSRLS;
