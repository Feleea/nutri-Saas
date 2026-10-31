#!/usr/bin/env bash
# Teste periódico de restore (US-LGP-04): faz dump, restaura em banco isolado e compara.
# Uso: DATABASE_URL_OWNER=postgresql://... ./scripts/test-restore.sh
# Requer: pg_dump, pg_restore e psql no PATH. Nunca aponte o destino para produção.
set -euo pipefail

SRC="${DATABASE_URL_OWNER:?defina DATABASE_URL_OWNER}"
DST_DB="suasnutri_restore"
DST="${SRC%/*}/${DST_DB}"
REPORT="restore-report-$(date +%Y%m%d-%H%M%S).txt"
DUMP="$(mktemp)"
trap 'rm -f "$DUMP"' EXIT

q() { psql "$1" -At -c "$2"; }

echo "== Restore de teste $(date -Is) ==" | tee "$REPORT"
pg_dump -Fc "$SRC" -f "$DUMP"
psql "$SRC" -c "DROP DATABASE IF EXISTS ${DST_DB}" -c "CREATE DATABASE ${DST_DB}" >/dev/null
pg_restore --no-owner --role=suasnutri_owner -d "$DST" "$DUMP"

fail=0
check() { # nome, consulta
  a="$(q "$SRC" "$2")"; b="$(q "$DST" "$2")"
  if [ "$a" = "$b" ]; then echo "OK   $1 ($a)" | tee -a "$REPORT"; else echo "FALHA $1 origem=$a restaurado=$b" | tee -a "$REPORT"; fail=1; fi
}

for t in Account Patient Membership Subscription UsageCounter AuditLog Food DeletionLedger; do
  check "linhas em $t" "SELECT count(*) FROM \"$t\""
done
check "tabelas com RLS ativo" "SELECT count(*) FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace"
check "políticas de RLS" "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'"
check "triggers de imutabilidade" "SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_immutable','admin_audit_immutable')"

# Exclusões já feitas não podem reaparecer: após restaurar, reaplicar o ledger (ver reapplyDeletionLedger).
echo "LEMBRETE: rode reapplyDeletionLedger no banco restaurado se ele vier de um backup anterior a exclusões recentes." | tee -a "$REPORT"
[ "$fail" = 0 ] && echo "RESULTADO: SUCESSO" | tee -a "$REPORT" || { echo "RESULTADO: FALHA" | tee -a "$REPORT"; exit 1; }
