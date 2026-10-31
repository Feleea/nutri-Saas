# Suas Nutri

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
npx prisma migrate dev --name init   # gera a migration inicial a partir do schema
npm run db:rls                   # aplica RLS, GRANTs, triggers e função de contadores
npm run db:seed                  # tenants sintéticos A e B
npm test
```
Depois de qualquer `migrate dev`/`reset`, rode `npm run db:rls` (ou use `npm run db:setup` / `npm run db:reset`).
Quando o schema estabilizar, mova `prisma/sql/rls.sql` para uma migration (`prisma migrate dev --create-only`) para que o deploy aplique tudo em uma etapa.

## Estrutura
- `prisma/schema.prisma`: Conta → Unidade → Usuário/Membership, planos, assinatura, contadores, pacientes, auditoria, alimentos.
- `prisma/sql/rls.sql`: políticas RLS, permissões, triggers e `refresh_usage_counters()`.
- `src/db/tenant.ts`: `forTenant(accountId)` define o contexto do tenant em cada operação.
- `src/db/admin.ts`: cliente do painel do dono.
- `tests/security`: suíte de isolamento e permissões (US-SEC-01, US-ADM-00, US-ADM-03, US-SEC-03).
- `tests/unit`: cálculos (US-PLA-02).

## Convenção de testes
O ID da história aparece no nome do teste (ex.: `US-SEC-01`) para rastreabilidade com o Jira. A suíte `test:security` roda em todo PR e bloqueia a integração.
