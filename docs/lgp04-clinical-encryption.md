# US-LGP-04: cifra clínica por tenant

## Dados e criptografia

- Respostas de anamnese, payload antropométrico (data da medição, peso, altura, IMC e circunferências) e cada payload completo de versão de plano alimentar (título, refeições, nomes/horários, quantidades, fontes e snapshots nutricionais) são armazenados em ciphertext AES-256-GCM.
- Cada conta recebe uma DEK aleatória de 256 bits, armazenada somente embrulhada por AES-256-GCM com a chave mestra `APP_ENCRYPTION_KEY`. A AAD da DEK vincula a conta; a AAD dos payloads vincula conta, registro/versão e tipo clínico. Em planos, o contexto contém ID do plano, número da versão e ID da linha de versão.
- A aplicação desempacota a DEK somente dentro dos caminhos clínicos autorizados (papel titular/profissional e consentimento ativo). A exportação LGPD passa pelo serviço autorizado. Logs e auditoria registram identificadores e ações, nunca valores clínicos.
- `APP_ENCRYPTION_KEY` é material crítico: manter fixa, com acesso restrito, fora do banco e do repositório, e incluí-la no plano de backup/restauração de segredos. A perda dessa chave torna as DEKs e os dados irrecuperáveis; sua rotação exige reembrulhar todas as DEKs antes de descartar a chave anterior.

## Migration e backfill sem perda

A migration `20261031223000_lgp04_clinical_encryption` cria a tabela de DEKs e renomeia as respostas antigas para `legacyAnswers`; as colunas antigas da antropometria tornam-se legadas e nullable. Ela preserva todos os valores existentes. Linhas novas são gravadas somente em ciphertext. A leitura temporária de campos legados permanece limitada aos caminhos clínicos autorizados até o backfill.

Procedimento obrigatório para cada ambiente:

1. Faça e verifique um backup do banco e da `APP_ENCRYPTION_KEY`; teste a restauração em ambiente isolado.
2. Coloque o app anterior em manutenção/pare gravações clínicas. Faça deploy do código e aplique migrations e permissões:
   `npx prisma migrate deploy` e `npm run db:rls`.
3. Configure a mesma `APP_ENCRYPTION_KEY` no processo operacional e execute primeiro o relatório, sem alterações:
   `npm run clinical:backfill -- --dry-run`.
4. Revise as contagens. Sem reativar gravações clínicas, execute:
   `npm run clinical:backfill -- --apply`.
   O script processa lotes pequenos, é retomável, não imprime conteúdo clínico e só apaga cada valor legado na mesma transação que grava ciphertext autenticado. Se houver erro, interrompe sem limpar a linha que falhou; corrija a causa e repita o dry-run/apply.
5. Execute novamente o dry-run e confirme zero registros pendentes. Faça smoke tests clínicos autorizados e de isolamento entre tenants, então reative o tráfego.

Não remova as colunas legadas nem altere a chave mestra nesta entrega. Se a implantação parar entre migration e backfill, os dados antigos continuam preservados e legíveis pelo caminho clínico. Não exponha backups/exports de banco durante esse estado.

## Operação e validação

- Requisitos de deploy: PostgreSQL com as migrations e `prisma/sql/clinical.sql` aplicados; `DATABASE_URL_OWNER` apenas na tarefa operacional de backfill; `APP_ENCRYPTION_KEY` estável e de 32 bytes em base64; TLS exigido pela infraestrutura ainda deve ser configurado/verificado fora do código.
- Para restore, restaure também a mesma chave mestra, reaplique o setup RLS e teste uma leitura clínica autorizada; sem a chave não existe recuperação por senha ou troca de tenant.
- Testes: `tests/unit/clinical-encryption.test.ts` cobre round-trip, chaves isoladas, AAD e adulteração; `tests/api/clinical.test.ts` cobre persistência sem valores clínicos plaintext.

## Planos alimentares

A migration `20261031232000_meal_plan_encryption` acrescenta o ciphertext da versão e permite limpar títulos antigos; `20261031233000_meal_plan_backfill_guard` permite somente a transição de backfill; `20261031234000_meal_plan_plaintext_guard` bloqueia novos inserts plaintext pelo papel da aplicação. Versões novas guardam o payload clínico completo cifrado; títulos/nomes/horários/itens e snapshots não são gravados nas tabelas de conteúdo. O API clínico e a exportação LGPD autorizada decifram após validar tenant e consentimento. O backfill `scripts/backfill-meal-plan-encryption.ts` migra versões existentes em transações por plano: grava o ciphertext autenticado, limpa o título plaintext, remove refeições/itens legados em cascata e limpa o título do plano. Reexecuções são seguras; erros preservam o plano em processamento.

Para cada ambiente, aplique `npx prisma migrate deploy` antes do novo app, configure a mesma `APP_ENCRYPTION_KEY` de 32 bytes base64 e mantenha disponíveis `DATABASE_URL_OWNER` e `DATABASE_URL` operacionalmente. Antes de reativar escrita clínica, execute `npm run meal-plans:backfill -- --dry-run`, revise a contagem, depois `npm run meal-plans:backfill -- --apply` e confirme novo dry-run com zero plaintext pendente. Preserve backup do banco e da chave mestra; restaurar sem a chave torna os dados inacessíveis. A leitura temporária compatível com versões legadas permanece somente no caminho clínico autorizado até o backfill.
