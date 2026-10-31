# Passo 0: validação técnica (fazer antes de escrever mais código)

Objetivo: transformar "código escrito" em "código verificado". Todo o código e os testes foram escritos sem execução em ambiente real; espere falhas na primeira rodada.

## 1. Preparar
```bash
cp .env.example .env          # preencher APP_ENCRYPTION_KEY (openssl rand -base64 32), GATEWAY_WEBHOOK_SECRET, JOB_SECRET
npm install
npm run db:up                 # Postgres 16 + papéis suasnutri_app e suasnutri_admin
npx prisma generate
npx prisma migrate dev --name inicial
npm run db:rls                # RLS, permissões, triggers, funções e índices (todos os scripts de prisma/sql)
```

## 2. Executar, nesta ordem (da mais barata para a mais cara)
| Etapa | Comando | O que esperar |
|---|---|---|
| Tipos | `npm run typecheck` | Erros de tipo do Prisma e do Next são prováveis; corrigir primeiro |
| Unitários | `npm run test:unit` | Não precisam de banco para a maioria; falha aqui indica erro de lógica |
| Segurança de serviços | `npm run test:security` | Precisam do banco e do `db:rls`. Falhas de "permission denied" inesperadas indicam GRANT faltando em `prisma/sql/*.sql` |
| Camada de API | `npx vitest run tests/api` | Chamam os handlers diretamente; falhas de importação de rota indicam erro de tipo/caminho |
| Build | `npx next build` | Valida tipos das rotas e páginas |

## 3. Triagem das falhas
1. **Falhas de infraestrutura primeiro** (migração, papéis, extensão `pg_trgm`, variáveis de ambiente). Elas derrubam muitos testes de uma vez.
2. **Isolamento e permissões** (`tests/security/isolation.test.ts`, `tests/api/security.test.ts`): qualquer falha aqui é prioridade máxima; nunca "ajustar o teste" para passar.
3. **Demais falhas, uma suíte por vez.** Corrija, rode só a suíte, depois rode tudo.
4. Testes que dependem de tempo (`performance.now()` em busca de alimentos e de pacientes): se falharem só por lentidão do ambiente, registrar a medida real antes de relaxar o limite.

## 4. Registrar
- Tempo gasto e número de falhas por categoria (primeira medida real de velocidade).
- Link do pipeline de CI verde.
- Atualizar a seção 15 do plano e marcar o primeiro item de `docs/gate-g0.md`.

## 5. Observações para quem testa
- Os testes de banco usam dados sintéticos e **apagam as tabelas** (`TRUNCATE ... CASCADE`) no início: nunca apontar para um banco com dados reais.
- Cada arquivo de teste recria os dois tenants fixos (A e B); os arquivos rodam em sequência (`fileParallelism: false`).
- Os e-mails são capturados em memória (`MAIL_DRIVER=memory`); nenhum e-mail real é enviado nos testes.
