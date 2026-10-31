# Política de retenção, exclusão e backup (RASCUNHO)

> Rascunho técnico para revisão do advogado de proteção de dados e do CFN/CRN (plano, seções 2 e 5). Os prazos abaixo são parâmetros iniciais, não orientação jurídica.

## Exclusão de paciente
- Exige confirmação explícita. Se houver prazo de guarda obrigatória configurado (`LGPD_CONFIG.retentionYears`), a exclusão e a anonimização são recusadas até o fim do prazo, e o sistema informa a data.
- **Excluir** remove a ficha e tudo o que depende dela. **Anonimizar** mantém o registro sem nome, e-mail, telefone e CPF, e fora das contagens de ativos.
- Cópias fora do banco (índice de busca, filas de lembrete, arquivos) são removidas por `DeletionHook`s. Falhas são reportadas ao chamador e devem gerar alerta.
- Cada exclusão grava um registro em `DeletionLedger` **sem dado pessoal** (conta, id, modo, data) e um evento na auditoria.

## Backups
- Backup diário, retenção inicial de **30 dias** (a confirmar).
- Dado excluído pode permanecer nas cópias de backup por até **30 dias**, sem uso operacional. Este é o prazo a informar ao titular.
- **Ao restaurar qualquer backup**, executar `reapplyDeletionLedger` antes de reabrir o acesso: ele reaplica exclusões e anonimizações posteriores ao backup.
- Restore testado periodicamente com `scripts/test-restore.sh`; guardar o relatório gerado.

## Exportações
- Arquivo cifrado em repouso (AES-256-GCM), acessível só por link com token, para usuários autorizados do tenant, e expira em 7 dias.
- Todo download e toda geração entram na auditoria.

## Pontos para decidir com o jurídico
- Prazo mínimo de guarda do prontuário (CFN/CRN) e se ele prevalece sobre o pedido de exclusão do paciente.
- Prazo de retenção dos dados de uma conta cancelada.
- Texto do aviso ao paciente sobre a permanência temporária em backups.
