import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { createLgpdService, reapplyDeletionLedger, type DeletionHook, type PatientDataSource } from '../../src/lgpd/service';
import type { SessionInfo } from '../../src/auth/service';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
let clock = Date.now();
const advanceDays = (d: number) => (clock += d * 86_400_000);
const now = () => new Date(clock);

const A: SessionInfo = { userId: `${TENANT_A}_user`, accountId: TENANT_A, role: 'TITULAR' };
const B: SessionInfo = { userId: `${TENANT_B}_user`, accountId: TENANT_B, role: 'TITULAR' };
const sec = (s: SessionInfo): SessionInfo => ({ ...s, role: 'SECRETARIA' });

const anamnese: PatientDataSource = { name: 'anamnese', collect: async (_t, id) => [{ pacienteId: id, queixa: 'dado sintético de teste' }] };
const purged: string[] = [];
const hooks: DeletionHook[] = [{ name: 'indice-busca', purge: async (id) => { purged.push(id); } }];
const lgpd = createLgpdService({ db, now, sources: [anamnese], hooks });

const mk = (id: string, accountId: string, fullName: string, extra: object = {}) =>
  owner.patient.create({ data: { id, accountId, fullName, email: `${id}@example.test`, phone: '11999990000', cpf: '000.000.000-00', ...extra } });
const refresh = () => adminDb.$executeRaw`SELECT refresh_usage_counters()`;
const total = async (accountId: string) => (await adminDb.usageCounter.findFirstOrThrow({ where: { accountId }, orderBy: { date: 'desc' } })).patientsTotal;

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect(), adminDb.$disconnect()]); });

describe('US-LGP-02 · exportar dados de um paciente [api][seg]', () => {
  it('gera arquivo legível com a ficha e as seções registradas, e audita', async () => {
    const r = await lgpd.exportPatient(A, 'pat_a1');
    if (!r.ok) throw new Error('export falhou');
    const d = await lgpd.downloadExport(A, r.token);
    if (!d.ok) throw new Error('download falhou');
    const json = JSON.parse(d.content);
    expect(json.secoes.ficha.fullName).toBe('Paciente A1');
    expect(json.secoes.anamnese[0].pacienteId).toBe('pat_a1');
    expect(d.filename).toBe('paciente-pat_a1.json');
    expect(await owner.auditLog.count({ where: { accountId: TENANT_A, action: 'PATIENT_EXPORT', resourceId: 'pat_a1' } })).toBe(1);
    expect(await owner.auditLog.count({ where: { accountId: TENANT_A, action: 'EXPORT_DOWNLOAD' } })).toBe(1);
  });

  it('o conteúdo fica cifrado em repouso', async () => {
    const row = await owner.dataExport.findFirstOrThrow({ where: { patientId: 'pat_a1' } });
    expect(row.payloadEnc.startsWith('v1.')).toBe(true);
    expect(row.payloadEnc).not.toContain('Paciente A1');
  });

  it('o link não funciona em outro tenant nem para a secretaria, e expira em 7 dias', async () => {
    const r = await lgpd.exportPatient(A, 'pat_a2');
    if (!r.ok) throw new Error();
    expect(await lgpd.downloadExport(B, r.token)).toEqual({ ok: false, reason: 'not_found' });
    expect(await lgpd.downloadExport(sec(A), r.token)).toEqual({ ok: false, reason: 'forbidden' });
    advanceDays(8);
    expect(await lgpd.downloadExport(A, r.token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('não exporta paciente de outro tenant nem sem papel clínico', async () => {
    expect(await lgpd.exportPatient(A, 'pat_b1')).toEqual({ ok: false, reason: 'not_found' });
    expect(await lgpd.exportPatient(sec(A), 'pat_a1')).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('US-LGP-03 · excluir ou anonimizar [e2e][api]', () => {
  it('exige confirmação explícita', async () => {
    await mk('pat_x1', TENANT_A, 'Para Excluir');
    expect(await lgpd.executeDeletion(A, 'pat_x1', { mode: 'DELETE', confirm: false })).toEqual({ ok: false, reason: 'confirmation_required' });
    expect(await owner.patient.count({ where: { id: 'pat_x1' } })).toBe(1);
  });

  it('exclui, remove cópias externas, audita sem dado pessoal, registra no ledger e deixa de ser contado', async () => {
    await refresh();
    const before = await total(TENANT_A);
    const r = await lgpd.executeDeletion(A, 'pat_x1', { mode: 'DELETE', confirm: true });
    expect(r).toEqual({ ok: true, purgeFailures: [] });
    expect(await owner.patient.count({ where: { id: 'pat_x1' } })).toBe(0);
    expect(purged).toContain('pat_x1');

    const audit = await owner.auditLog.findFirstOrThrow({ where: { action: 'PATIENT_DELETED', resourceId: 'pat_x1' } });
    expect(JSON.stringify(audit)).not.toContain('Para Excluir');
    expect(await owner.deletionLedger.count({ where: { patientId: 'pat_x1', mode: 'DELETE' } })).toBe(1);
    await refresh();
    expect(await total(TENANT_A)).toBe(before - 1);
  });

  it('anonimizar mantém o registro sem dados pessoais e fora da contagem de ativos', async () => {
    await mk('pat_x2', TENANT_A, 'Para Anonimizar');
    expect((await lgpd.executeDeletion(A, 'pat_x2', { mode: 'ANONYMIZE', confirm: true })).ok).toBe(true);
    const p = await owner.patient.findUniqueOrThrow({ where: { id: 'pat_x2' } });
    expect(p).toMatchObject({ fullName: 'Paciente removido', email: null, phone: null, cpf: null, status: 'ARCHIVED' });
  });

  it('falha em limpar uma cópia externa é reportada, sem desfazer a exclusão', async () => {
    await mk('pat_x3', TENANT_A, 'Falha Hook');
    const failing = createLgpdService({ db, now, hooks: [{ name: 'fila-lembretes', purge: async () => { throw new Error('indisponível'); } }] });
    expect(await failing.executeDeletion(A, 'pat_x3', { mode: 'DELETE', confirm: true })).toEqual({ ok: true, purgeFailures: ['fila-lembretes'] });
    expect(await owner.patient.count({ where: { id: 'pat_x3' } })).toBe(0);
  });

  it('informa e respeita o prazo de guarda obrigatória configurado', async () => {
    const guarded = createLgpdService({ db, now, config: { retentionYears: 5, exportDays: 7 } });
    await mk('pat_x4', TENANT_A, 'Em Guarda');
    const info = await guarded.requestDeletion(A, 'pat_x4');
    expect(info).toMatchObject({ ok: true, blocked: true });
    const r = await guarded.executeDeletion(A, 'pat_x4', { mode: 'DELETE', confirm: true });
    expect(r).toMatchObject({ ok: false, reason: 'retention_period' });
    expect(await owner.patient.count({ where: { id: 'pat_x4' } })).toBe(1);
  });

  it('não exclui paciente de outro tenant nem sem papel clínico', async () => {
    expect(await lgpd.executeDeletion(A, 'pat_b1', { mode: 'DELETE', confirm: true })).toEqual({ ok: false, reason: 'not_found' });
    expect(await lgpd.executeDeletion(sec(A), 'pat_a1', { mode: 'DELETE', confirm: true })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await owner.patient.count({ where: { id: { in: ['pat_b1', 'pat_a1'] } } })).toBe(2);
  });

  it('após restaurar um backup, o ledger reaplica as exclusões (dado excluído não ressuscita)', async () => {
    // simula a restauração: o paciente excluído volta junto com o backup
    await mk('pat_x1', TENANT_A, 'Voltou do Backup');
    await owner.patient.update({ where: { id: 'pat_x2' }, data: { fullName: 'Voltou Anonimizado', email: 'x@example.test' } });
    expect(await reapplyDeletionLedger(owner)).toBe(2);
    expect(await owner.patient.count({ where: { id: 'pat_x1' } })).toBe(0);
    expect((await owner.patient.findUniqueOrThrow({ where: { id: 'pat_x2' } })).email).toBeNull();
  });

  it('a aplicação não consegue editar nem apagar o ledger', async () => {
    await expect(db.$executeRawUnsafe(`DELETE FROM "DeletionLedger"`)).rejects.toThrow(/permission denied/i);
  });
});
