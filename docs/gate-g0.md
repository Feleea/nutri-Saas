# Gate G0: checklist de saída da Fase 0

Fonte: seção 10.7 do plano (`docs/plano-de-desenvolvimento.md`; o detalhamento está na seção 15 desse documento).
Marque cada item só com evidência (relatório, link do CI, e-mail do advogado).

## Evidência técnica local (31/10/2026)
- PostgreSQL 16 descartável: 13 migrations aplicadas; `prisma/sql/clinical.sql` incluído no setup de RLS.
- `npm test -- --run --maxWorkers=1 --minWorkers=1`: 355 testes passaram; `npm run typecheck`, `npx prisma validate` e `npm run build` passaram.
- Restore validado em banco isolado: [relatório](restore-report-20261031.txt). A validação usou somente dados sintéticos.
- **US-LGP-05 concluída localmente:** testes focados de autenticação, equipe, administração, MFA e RLS passaram; tentativas existentes/inexistentes compartilham evento sem e-mail/identidade e as trilhas de permissão registram ator, papel e origem.
- **US-ANA-01 a 03 concluídas localmente:** anamnese versionada e antropometria; registros exigem consentimento `DATA_PROCESSING` ativo.
- **US-LGP-04 (cifra clínica) implementada localmente:** chaves de dados aleatórias por tenant, embrulhadas por `APP_ENCRYPTION_KEY`; anamnese, antropometria e versões de planos alimentares usam AES-256-GCM com AAD contextual. Backfills explícitos e retomáveis preservam dados legados até confirmar a cifra; execução operacional antes do deploy, TLS de produção e teste de restore com a chave preservada continuam pendentes.
- **US-PLA-04/05 implementadas localmente:** alimentos próprios, receitas com composição/snapshot por rendimento, substituições com comparação de energia e macros e persistência cifrada na versão do plano.
- **US-PLA-06 parcial localmente:** página de impressão/PDF com dados do profissional disponíveis (nome, CRN e contato), paciente, refeições, substituições e totais; o cadastro ainda não oferece logo e o teste de navegador/identidade visual completa continua pendente.
- A migration inicial estava incompleta (15 de 30 modelos); foi complementada. A suíte também revelou e corrigiu busca por nome com pontuação e expectativas incorretas em dois testes.
- **Ainda não há execução do workflow no GitHub Actions**; evidência local não substitui o CI.

## Critérios de saída
- [ ] **Testes executados e verdes no CI.** Testes locais passaram; falta executar o workflow e anexar o link do pipeline.
- [ ] **Isolamento entre tenants e permissões do super-admin no pipeline.** `npm run test:security` passou localmente; falta confirmar no workflow bloqueador de PR (`.github/workflows/ci.yml`).
- [ ] **TACO e TBCA importadas e validadas contra amostra de referência.**
  - [ ] Arquivos reais obtidos e condições de uso confirmadas por escrito.
  - [ ] Importador ajustado ao formato real, se necessário (`npm run foods:import`).
  - [ ] Amostra de referência definida e conferida (`verifyReferenceSample`).
- [ ] **Fluxo cadastro → trial → contratação → cobrança em staging com o gateway em modo de teste.**
  - [ ] Gateway escolhido (Asaas, Iugu ou Pagar.me) e adaptador escrito (`src/billing/gateway.ts`).
  - [ ] Nota fiscal definida.
  - [ ] Ambiente de staging criado, com dados sintéticos.
- [x] **Restore de backup testado e documentado.** `scripts/test-restore.sh` passou em banco isolado; relatório arquivado em [`docs/restore-report-20261031.txt`](restore-report-20261031.txt).
- [ ] **Termos, política de privacidade e DPA revisados por advogado.** Incluir `docs/politica-retencao-backup.md` e o texto de consentimento do paciente.

## Histórias P1 da Fase 0 ainda parciais
| História | O que falta |
|---|---|
| US-PLN-02 | Gateway real e nota fiscal |
| US-LGP-01 | Exigir novo aceite quando a versão dos termos mudar |
| US-LGP-03 | Prazo de guarda do prontuário (CFN/CRN e jurídico) |
| US-LGP-04 | TLS exigido e verificado na infraestrutura de produção; aplicar migrations e executar ambos os backfills conforme [`lgp04-clinical-encryption.md`](lgp04-clinical-encryption.md); testar restore com `APP_ENCRYPTION_KEY` preservada |
| US-ENG-01 | Relatório de cobertura com meta; testes de navegador |
| US-ENG-02 | Ambientes dev, staging e produção separados |
| US-ENG-03 | Monitoramento de erros sem dados de pacientes; plano de resposta a incidentes |

## Progresso do plano alimentar
- Receitas e alimentos próprios estão disponíveis em `/alimentos`; as composições guardam snapshots nutricionais e a remoção da receita limpa a composição em cascata.
- O editor de planos permite incluir substituições, alterar a quantidade e comparar energia/macros com tolerância de 10%; nutrientes não informados não são tratados como equivalentes.
- A opção “Imprimir ou salvar em PDF” usa a impressão do navegador. A logo do profissional e validação visual em navegador ainda precisam ser concluídas.

## Operação a configurar antes do piloto
- [ ] Agendador (cron) chamando `POST /api/jobs/reminders` a cada 5–10 minutos e `POST /api/jobs/daily` uma vez por dia, com `x-job-secret`.
- [ ] Provedor de e-mail real (`MAIL_DRIVER`); em produção o app não inicia sem ele.
- [ ] Segredos de produção: `APP_ENCRYPTION_KEY`, `GATEWAY_WEBHOOK_SECRET`, `JOB_SECRET`, senhas dos três papéis de banco.
