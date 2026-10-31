# Gate G0: checklist de saída da Fase 0

Fonte: seção 10.7 do plano (`docs/plano-de-desenvolvimento.md`; o detalhamento está na seção 15 desse documento).
Marque cada item só com evidência (relatório, link do CI, e-mail do advogado). **Nada abaixo foi verificado em ambiente real até hoje.**

## Critérios de saída
- [ ] **Testes executados e verdes no CI.** Rodar o Passo 0 (`docs/validacao-passo-0.md`) e anexar o link do pipeline.
- [ ] **Isolamento entre tenants e permissões do super-admin no pipeline.** `npm run test:security` bloqueando PR. (Pipeline escrito em `.github/workflows/ci.yml`, ainda não executado.)
- [ ] **TACO e TBCA importadas e validadas contra amostra de referência.**
  - [ ] Arquivos reais obtidos e condições de uso confirmadas por escrito.
  - [ ] Importador ajustado ao formato real, se necessário (`npm run foods:import`).
  - [ ] Amostra de referência definida e conferida (`verifyReferenceSample`).
- [ ] **Fluxo cadastro → trial → contratação → cobrança em staging com o gateway em modo de teste.**
  - [ ] Gateway escolhido (Asaas, Iugu ou Pagar.me) e adaptador escrito (`src/billing/gateway.ts`).
  - [ ] Nota fiscal definida.
  - [ ] Ambiente de staging criado, com dados sintéticos.
- [ ] **Restore de backup testado e documentado.** `scripts/test-restore.sh` executado e relatório arquivado.
- [ ] **Termos, política de privacidade e DPA revisados por advogado.** Incluir `docs/politica-retencao-backup.md` e o texto de consentimento do paciente.

## Histórias P1 da Fase 0 ainda parciais
| História | O que falta |
|---|---|
| US-PLN-02 | Gateway real e nota fiscal |
| US-LGP-01 | Exigir novo aceite quando a versão dos termos mudar |
| US-LGP-03 | Prazo de guarda do prontuário (CFN/CRN e jurídico) |
| US-LGP-04 | TLS exigido na infraestrutura; chaves de cifra por tenant; restore executado |
| US-LGP-05 | Auditar falhas de login e mudanças de permissão |
| US-ENG-01 | Relatório de cobertura com meta; testes de navegador |
| US-ENG-02 | Ambientes dev, staging e produção separados |
| US-ENG-03 | Monitoramento de erros sem dados de pacientes; plano de resposta a incidentes |

## Operação a configurar antes do piloto
- [ ] Agendador (cron) chamando `POST /api/jobs/reminders` a cada 5–10 minutos e `POST /api/jobs/daily` uma vez por dia, com `x-job-secret`.
- [ ] Provedor de e-mail real (`MAIL_DRIVER`); em produção o app não inicia sem ele.
- [ ] Segredos de produção: `APP_ENCRYPTION_KEY`, `GATEWAY_WEBHOOK_SECRET`, `JOB_SECRET`, senhas dos três papéis de banco.
