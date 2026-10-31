# Suas Nutri

> **Documentação:** plano e andamento em [`docs/plano-de-desenvolvimento.md`](docs/plano-de-desenvolvimento.md) (seção 15) · checklist do gate G0 em [`docs/gate-g0.md`](docs/gate-g0.md) · como validar o código em [`docs/validacao-passo-0.md`](docs/validacao-passo-0.md) · política de retenção e backup em [`docs/politica-retencao-backup.md`](docs/politica-retencao-backup.md).
> **Situação (31/10/2026):** validação local em PostgreSQL 16 concluída: 309 testes, typecheck, build e restore passaram. O CI ainda precisa ser executado; o Gate G0 continua bloqueado por decisões de gateway, licenças de dados e revisão jurídica.

SaaS multi-tenant para nutricionistas (clínico e produção/qualidade). Stack: TypeScript, PostgreSQL 16, Prisma, Vitest, GitHub Actions.
Este repositório implementa a **Fase 0 (Fundação)** do plano, começando por isolamento de tenants e painel do dono.

## Princípios aplicados
- **RLS no Postgres**: o isolamento vale mesmo se a aplicação esquecer um `where`.
- **Três papéis de banco**: `owner` (migrations/seed), `app` (nutricionistas, sujeito ao RLS) e `admin` (painel do dono, sem GRANT em tabelas clínicas).
- **Contadores por função `SECURITY DEFINER`**: o dono vê quantidade de pacientes sem nunca ler pacientes.
- **Auditoria imutável** (trigger + sem GRANT de UPDATE/DELETE).
- **Nutriente nulo ≠ zero**: modelo e cálculo tratam "não informado" explicitamente.

## Primeira execução
```bash
cp .env.example .env
npm install
npm run db:up                    # Postgres + papéis (docker/init-roles.sql)
npm run db:setup                 # aplica migrations e RLS, GRANTs, triggers e funções
npm run db:seed                  # tenants sintéticos A e B
npm test
```
**Atenção:** `npm test` e `npm run db:seed` limpam tabelas centrais e recriam dados sintéticos. Use somente um banco descartável, nunca o banco de produção ou com dados reais.
Depois de qualquer `migrate dev`/`reset`, rode `npm run db:rls` (ou use `npm run db:setup` / `npm run db:reset`).

## Estrutura
- `prisma/schema.prisma`: Conta → Unidade → Usuário/Membership, planos, assinatura, contadores, pacientes, auditoria, alimentos.
- `prisma/sql/rls.sql`: políticas RLS, permissões, triggers e `refresh_usage_counters()`.
- `src/db/tenant.ts`: `forTenant(accountId)` define o contexto do tenant em cada operação.
- `src/db/admin.ts`: cliente do painel do dono.
- `tests/security`: suíte de isolamento e permissões (US-SEC-01, US-ADM-00, US-ADM-03, US-SEC-03).
- `tests/unit`: cálculos (US-PLA-02).

## Convenção de testes
O ID da história aparece no nome do teste (ex.: `US-SEC-01`) para rastreabilidade com o Jira. A suíte `test:security` roda em todo PR e bloqueia a integração.

## Autenticação (US-AUT-01 e US-AUT-02)
- `src/auth/service.ts`: cadastro com trial de 14 dias, confirmação de e-mail, login com bloqueio após 5 falhas, sessões no servidor com expiração por inatividade e logout imediato. Relógio injetável nos testes.
- `prisma/sql/auth.sql`: funções `SECURITY DEFINER` (`signup_create_tenant`, `auth_memberships`), pois cadastro e login ocorrem antes de haver tenant no contexto.
- Depois de puxar esta atualização: `npx prisma migrate dev --name auth && npm run db:rls && npm test`.

## Recuperação de senha e 2FA (US-AUT-03 e US-AUT-04)
- `src/auth/totp.ts`: TOTP (RFC 6238) sem dependências, validado com os vetores oficiais; anti-reuso do código; códigos de recuperação.
- `src/crypto/secrets.ts`: AES-256-GCM para o segredo TOTP. Defina `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`).
- `src/auth/service.ts`: `requestPasswordReset`/`resetPassword` (link de 1 h, uso único, encerra sessões, avisa titulares), `login` → `verifyMfa` (senha sozinha não cria sessão), `beginTotpSetup`/`confirmTotpSetup` e `disableTotp` (exige senha e código atual).
- `src/auth/admin.ts`: login do super-admin com senha + TOTP sempre obrigatórios, sessão de 15 min e bloqueio por tentativas.
- Aplicar: `npx prisma migrate dev --name mfa && npm run db:rls && npm test`.

## Equipe e cobrança (US-AUT-05 e US-PLN-01 a 04)
- `src/team/service.ts`: convites (7 dias, uso único, limite de usuários do plano), aceite que respeita o tenant do convite, remoção com revogação imediata. Aceite via `invitation_accept()` (SECURITY DEFINER).
- `src/billing/service.ts` (roda como `suasnutri_admin`; nunca exposto direto ao cliente): planos como configuração, checkout, webhook do gateway idempotente e com assinatura HMAC, upgrade/downgrade, trial vencido, atraso e carência.
- `src/billing/limits.ts`: regras puras de acesso (`FULL`, `NO_NEW_PATIENTS`, `READ_ONLY`). Nunca bloqueia o acesso aos dados dos pacientes nem a exportação.
- `src/billing/gateway.ts`: porta do gateway + adaptador HMAC genérico (sandbox). Trocar pelo adaptador do gateway escolhido (Asaas, Iugu, Pagar.me).
- Aplicar: `npx prisma migrate dev --name team_billing && npm run db:rls && npm test`.

## Base de alimentos, LGPD e painel do dono (US-ALI, US-LGP-02/03, US-ADM-00)
- `src/foods/`: importador idempotente (`importFoodTable`, CLI `npm run foods:import`), busca sem acentos com sinônimos e tabela padrão primeiro, alimentos próprios com alerta de consistência, medidas caseiras. Índice `pg_trgm` em `prisma/sql/foods-lgpd.sql`.
- `tests/fixtures/foods-sample.csv`: dados **sintéticos**. Os valores reais de TACO/TBCA precisam ser importados com a licença confirmada.
- `src/lgpd/service.ts`: exportação cifrada com link que expira, exclusão/anonimização com prazo de guarda configurável, ganchos para limpar cópias externas e `reapplyDeletionLedger` para pós-restore. Política em `docs/politica-retencao-backup.md`.
- `src/admin/panel.ts`: lista/filtros/CSV/detalhe de tenants, suspensão, reativação e extensão de trial, tudo exigindo sessão de super-admin com 2FA e auditado.
- `docs/gate-g0.md`: checklist de saída da Fase 0. `scripts/test-restore.sh`: teste de restore.
- Aplicar: `npx prisma migrate dev --name foods_lgpd && npm run db:rls && npm test`.

## Camada web (Next.js)
```bash
cp .env.example .env     # preencha APP_ENCRYPTION_KEY e GATEWAY_WEBHOOK_SECRET
npm install && npx prisma generate
npm run dev              # http://localhost:3000
```
- `app/api/**`: rotas HTTP finas sobre os serviços. Cada rota usa `defineRoute` (`src/server/http.ts`) e declara `auth` (`public`, `session`, `admin` ou `webhook`) e, nas de sessão, uma ação da matriz `src/server/permissions.ts`.
- Sessão por cookie HttpOnly + SameSite=Lax (`sn_session` para clientes, `sn_admin` para o dono, separados). O token não vai no corpo das respostas.
- Telas: `/login`, `/cadastro`, `/convite`, `/painel`, `/admin/login`, `/admin`, `/admin/tenants/[id]`.
- Em desenvolvimento os e-mails saem no console (`MAIL_DRIVER=console`). Em produção o app não inicia sem provedor configurado.
- Testes: `tests/api/*` chamam os handlers diretamente com `Request`, sem subir o Next. Rode `npm test`.

## Pacientes e limites do plano (Fase 1: US-PAC-01 a 04, US-ADM-02)
- `src/patients/service.ts`: cadastro, busca, edição, arquivar/restaurar, consentimento LGPD e aplicação dos limites. O limite é lido ao vivo do plano e do banco (não dos contadores diários), com trava por tenant (`pg_advisory_xact_lock`) para cadastros simultâneos.
- Quando o limite é atingido só novos cadastros (e restaurações) são bloqueados. Leitura, edição, exportação e exclusão continuam.
- Avisos aos 80% e 100%: `Notice` na plataforma (`/api/notices`, só titular) e e-mail, uma vez por cruzamento; rearmam ao voltar abaixo do limite.
- Telas: `/pacientes`, `/pacientes/novo`, `/pacientes/[id]`.
- Aplicar: `npx prisma migrate dev --name patients && npm run db:rls && npm test`.

## Agenda e lembretes (Fase 1: US-AGE-01 a 03 e 06)
- `src/agenda/service.ts`: marcar, reagendar, cancelar e mudar situação; conflito por profissional com confirmação; fuso e duração padrão por conta. As consultas guardam instantes em UTC e exibem no fuso da conta (`src/agenda/time.ts`, sem dependências).
- A secretária usa a mesma agenda (`agenda.read/write`), que só expõe nome, horário, profissional e situação. A busca de pacientes para agendar devolve apenas id e nome.
- `src/agenda/reminders.ts`: job de lembretes por e-mail. Um lembrete por consulta e horário; reagendar ou cancelar cancela o pendente; sem e-mail ou com opt-out, o lembrete já nasce "pulado" e a agenda mostra o motivo; falhas têm até 3 tentativas com espera crescente; execuções simultâneas não duplicam.
- Rotinas: `POST /api/jobs/reminders` (a cada poucos minutos) e `POST /api/jobs/daily` (uma vez por dia), autenticadas por `JOB_SECRET` no cabeçalho `x-job-secret`.
- Telas: `/agenda`, `/agenda/novo`. Aplicar: `npx prisma migrate dev --name agenda && npm run db:rls && npm test`.
