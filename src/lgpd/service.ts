import { PrismaClient } from '@prisma/client';
import { forTenant, withTenant } from '../db/tenant';
import { newToken, hashToken } from '../auth/password';
import { encryptSecret, decryptSecret } from '../crypto/secrets';
import type { SessionInfo } from '../auth/service';

/**
 * retentionYears: prazo mínimo de guarda do prontuário. 0 = sem trava.
 * ATENÇÃO: o valor real depende de orientação do CFN/CRN e do jurídico (plano, seção 5); defina antes do lançamento.
 */
export const LGPD_CONFIG = { retentionYears: 0, exportDays: 7 };

type Tenant = ReturnType<typeof forTenant>;
/** Fases seguintes registram aqui suas seções (anamnese, planos, anexos...) sem mexer neste serviço. */
export interface PatientDataSource {
  name: string;
  collect(t: Tenant, patientId: string): Promise<unknown>;
}
/** Remove cópias do paciente fora do banco: índice de busca, filas de lembrete, arquivos... */
export interface DeletionHook {
  name: string;
  purge(patientId: string, accountId: string): Promise<void>;
}

interface Deps {
  db: PrismaClient; // suasnutri_app
  now?: () => Date;
  config?: typeof LGPD_CONFIG;
  sources?: PatientDataSource[];
  hooks?: DeletionHook[];
}

const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);
const DAY = 86_400_000;

export function createLgpdService({ db, now = () => new Date(), config = LGPD_CONFIG, sources = [], hooks = [] }: Deps) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);

  // ───────────── US-LGP-02: exportar dados de um paciente ─────────────
  async function exportPatient(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return { ok: false as const, reason: 'forbidden' as const };
    const t = tenant(s);
    const patient = await t.patient.findUnique({ where: { id: patientId } });
    if (!patient) return { ok: false as const, reason: 'not_found' as const };

    const sections: Record<string, unknown> = { ficha: patient };
    for (const src of sources) sections[src.name] = await src.collect(t, patientId);
    const json = JSON.stringify({ geradoEm: now().toISOString(), paciente: patientId, secoes: sections }, null, 2);

    const { token, hash } = newToken();
    const expiresAt = new Date(now().getTime() + config.exportDays * DAY);
    await t.dataExport.create({
      data: {
        accountId: s.accountId, patientId, kind: 'PATIENT', tokenHash: hash,
        payloadEnc: encryptSecret(json), // cifrado em repouso
        expiresAt, createdByUserId: s.userId, createdAt: now(),
      },
    });
    await t.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'PATIENT_EXPORT', resource: 'Patient', resourceId: patientId } });
    return { ok: true as const, token, expiresAt };
  }

  /** O link só funciona para usuários autorizados do mesmo tenant e antes de expirar. */
  async function downloadExport(s: SessionInfo, token: string) {
    if (!CLINICAL.has(s.role)) return { ok: false as const, reason: 'forbidden' as const };
    const t = tenant(s);
    const row = await t.dataExport.findFirst({ where: { tokenHash: hashToken(token) } });
    if (!row) return { ok: false as const, reason: 'not_found' as const };
    if (row.expiresAt <= now()) return { ok: false as const, reason: 'expired' as const };
    await t.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'EXPORT_DOWNLOAD', resource: 'DataExport', resourceId: row.id } });
    return { ok: true as const, filename: `paciente-${row.patientId}.json`, content: decryptSecret(row.payloadEnc) };
  }

  // ───────────── US-LGP-03: excluir ou anonimizar ─────────────
  async function requestDeletion(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return { ok: false as const, reason: 'forbidden' as const };
    const p = await tenant(s).patient.findUnique({ where: { id: patientId } });
    if (!p) return { ok: false as const, reason: 'not_found' as const };
    const retainUntil = config.retentionYears > 0 ? addYears(p.lastActivityAt, config.retentionYears) : null;
    return { ok: true as const, retainUntil, blocked: retainUntil !== null && retainUntil > now() };
  }

  async function executeDeletion(s: SessionInfo, patientId: string, opts: { mode: 'DELETE' | 'ANONYMIZE'; confirm: boolean }) {
    if (!opts.confirm) return { ok: false as const, reason: 'confirmation_required' as const };
    const info = await requestDeletion(s, patientId);
    if (!info.ok) return info;
    if (info.blocked) return { ok: false as const, reason: 'retention_period' as const, retainUntil: info.retainUntil };

    await withTenant(s.accountId, async (tx) => {
      await tx.deletionLedger.create({ data: { accountId: s.accountId, patientId, mode: opts.mode, createdAt: now() } });
      await tx.auditLog.create({
        data: { accountId: s.accountId, actorUserId: s.userId, action: opts.mode === 'DELETE' ? 'PATIENT_DELETED' : 'PATIENT_ANONYMIZED', resource: 'Patient', resourceId: patientId },
      });
      if (opts.mode === 'DELETE') await tx.patient.delete({ where: { id: patientId } });
      else await tx.patient.update({ where: { id: patientId }, data: anonymized(now()) });
    }, db);

    // cópias fora do banco (índices, filas, arquivos); falhas são reportadas, não escondidas
    const purgeFailures: string[] = [];
    for (const h of hooks) {
      try { await h.purge(patientId, s.accountId); } catch { purgeFailures.push(h.name); }
    }
    return { ok: true as const, purgeFailures };
  }

  return { exportPatient, downloadExport, requestDeletion, executeDeletion };
}

const anonymized = (at: Date) => ({
  fullName: 'Paciente removido', normalizedName: 'paciente removido', goal: null, tags: [] as string[],
  email: null, phone: null, cpf: null, status: 'ARCHIVED' as const, archivedAt: at,
});

function addYears(d: Date, years: number) {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
}

/**
 * Após restaurar um backup, reaplica as exclusões já feitas (o registro não guarda dado pessoal).
 * Roda como dono do schema, em operação de restauração. Retorna quantos pacientes foram removidos de novo.
 */
export async function reapplyDeletionLedger(owner: PrismaClient): Promise<number> {
  const rows = await owner.deletionLedger.findMany({ orderBy: { createdAt: 'asc' } });
  let n = 0;
  for (const r of rows) {
    const exists = await owner.patient.findUnique({ where: { id: r.patientId } });
    if (!exists) continue;
    if (r.mode === 'DELETE') await owner.patient.delete({ where: { id: r.patientId } });
    else await owner.patient.update({ where: { id: r.patientId }, data: anonymized(new Date()) });
    n++;
  }
  return n;
}
