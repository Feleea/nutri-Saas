import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type AccountStatus } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { createPatientService, consentDataSource, PATIENT_CONSENT_VERSION } from '../../src/patients/service';
import { createLgpdService } from '../../src/lgpd/service';
import { MemoryMailer } from '../../src/auth/mailer';
import { normalizeName } from '../../src/foods/normalize';
import type { SessionInfo } from '../../src/auth/service';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
const mailer = new MemoryMailer();
const patients = createPatientService({ db, mailer });
const lgpd = createLgpdService({
  db, sources: [consentDataSource],
  hooks: [{ name: 'avisos-de-limite', purge: (_id, accountId) => patients.reconcileLimitNotices(accountId) }],
});

const sess = (id: string, role: SessionInfo['role'] = 'TITULAR'): SessionInfo => ({ userId: `${id}_u`, accountId: id, role });
const valid = (n: string, extra: object = {}) => ({ fullName: n, phone: '11999990000', ...extra });
const DAY = 86_400_000;

async function mkAccount(id: string, o: { limit?: number | null; status?: AccountStatus; trialEndsAt?: Date; graceEndsAt?: Date } = {}) {
  const limit = o.limit === undefined ? 30 : o.limit;
  const planId = `plan_lim_${limit ?? 'inf'}`;
  await owner.plan.upsert({
    where: { id: planId }, update: {},
    create: { id: planId, code: planId, name: planId, priceCents: 1000, modules: ['CLINICO'], patientLimit: limit },
  });
  await owner.account.create({ data: { id, name: id, email: `${id}@example.test`, status: o.status ?? 'ACTIVE', trialEndsAt: o.trialEndsAt } });
  await owner.subscription.create({ data: { accountId: id, planId, graceEndsAt: o.graceEndsAt } });
  return sess(id);
}
const setPlan = (accountId: string, limit: number | null) =>
  owner.plan.upsert({ where: { id: `plan_lim_${limit ?? 'inf'}` }, update: {}, create: { id: `plan_lim_${limit ?? 'inf'}`, code: `plan_lim_${limit ?? 'inf'}`, name: 'x', priceCents: 1, modules: ['CLINICO'], patientLimit: limit } })
    .then(() => owner.subscription.update({ where: { accountId }, data: { planId: `plan_lim_${limit ?? 'inf'}` } }));
const count = (accountId: string, status = 'ACTIVE') => owner.patient.count({ where: { accountId, status: status as any } });
const mails = (to: string, kind: string) => mailer.outbox.filter((m) => m.to === to && m.kind === kind);
const notices = (accountId: string) => owner.notice.findMany({ where: { accountId } }).then((n) => n.map((x) => x.kind).sort());

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect(), adminDb.$disconnect()]); });

describe('US-PAC-01 · cadastrar paciente [e2e][api][seg]', () => {
  const A = sess(TENANT_A), B = sess(TENANT_B);

  it('cria com nome e contato, aparece na lista como ativo e é auditado', async () => {
    const r = await patients.create(A, valid('  Ana Beatriz ', { tags: ['Gestante'], goal: 'Ganho de peso saudável' }));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.patient).toMatchObject({ fullName: 'Ana Beatriz', status: 'ACTIVE', tags: ['gestante'] });
    const list = await patients.list(A, { q: 'ana' });
    expect(list.ok && list.items.map((p) => p.id)).toContain(r.patient.id);
    expect(await owner.auditLog.count({ where: { accountId: TENANT_A, action: 'PATIENT_CREATED', resourceId: r.patient.id } })).toBe(1);
    expect((await owner.patient.findUniqueOrThrow({ where: { id: r.patient.id } })).normalizedName).toBe('ana beatriz');
  });

  it('nome em branco, sem contato, e-mail ou CPF inválidos: erro por campo e nada gravado', async () => {
    const before = await owner.patient.count({ where: { accountId: TENANT_A } });
    expect(await patients.create(A, valid('  '))).toMatchObject({ ok: false, reason: 'validation', errors: ['name_required'] });
    expect(await patients.create(A, { fullName: 'Sem Contato' })).toMatchObject({ errors: ['contact_required'] });
    expect(await patients.create(A, valid('X', { cpf: '123.456.789-00' }))).toMatchObject({ errors: ['cpf_invalid'] });
    expect(await patients.create(A, valid('X', { email: 'nao-e-email' }))).toMatchObject({ errors: ['email_invalid'] });
    expect(await owner.patient.count({ where: { accountId: TENANT_A } })).toBe(before);
  });

  it('CPF duplicado na conta avisa e só cadastra com confirmação; o CPF é guardado só com dígitos', async () => {
    const first = await patients.create(A, valid('Paciente CPF 1', { cpf: '529.982.247-25' }));
    expect(first.ok).toBe(true);
    const dup = await patients.create(A, valid('Paciente CPF 2', { cpf: '52998224725' }));
    expect(dup).toMatchObject({ ok: false, reason: 'duplicate_cpf', needsConfirm: true });
    expect(await owner.patient.count({ where: { accountId: TENANT_A, fullName: 'Paciente CPF 2' } })).toBe(0);
    expect((await patients.create(A, valid('Paciente CPF 2', { cpf: '52998224725', confirmDuplicate: true }))).ok).toBe(true);
    expect((await owner.patient.findFirstOrThrow({ where: { fullName: 'Paciente CPF 1' } })).cpf).toBe('52998224725');
    const list = await patients.list(A, { q: 'paciente cpf 1' });
    expect(list.ok && list.items[0].cpf).toBe('***.***.247-25'); // máscara na listagem
  });

  it('o mesmo CPF em outro tenant não conta como duplicado', async () => {
    expect((await patients.create(B, valid('Paciente CPF no B', { cpf: '529.982.247-25' }))).ok).toBe(true);
  });

  it('paciente de um tenant é invisível para outro: lista, busca, leitura, edição e arquivamento', async () => {
    const mine = await patients.create(A, valid('Só do A Silva'));
    if (!mine.ok) throw new Error();
    const id = mine.patient.id;
    const seenByB = await patients.list(B, { q: 'so do a' });
    expect(seenByB.ok && seenByB.total).toBe(0);
    expect(await patients.get(B, id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await patients.update(B, id, { goal: 'invadido' })).toEqual({ ok: false, reason: 'not_found' });
    expect(await patients.archive(B, id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await patients.recordConsent(B, id)).toEqual({ ok: false, reason: 'not_found' });
    expect((await owner.patient.findUniqueOrThrow({ where: { id } })).goal).toBeNull();
  });

  it('a secretária não acessa nenhum dado de paciente', async () => {
    const S = sess(TENANT_A, 'SECRETARIA');
    const forbidden = { ok: false, reason: 'forbidden' };
    expect(await patients.create(S, valid('X'))).toEqual(forbidden);
    expect(await patients.list(S)).toEqual(forbidden);
    expect(await patients.get(S, 'pat_a1')).toEqual(forbidden);
    expect(await patients.update(S, 'pat_a1', { goal: 'x' })).toEqual(forbidden);
    expect(await patients.archive(S, 'pat_a1')).toEqual(forbidden);
    expect(await patients.recordConsent(S, 'pat_a1')).toEqual(forbidden);
  });
});

describe('US-PAC-02 · buscar e filtrar [api][e2e]', () => {
  let S: SessionInfo;
  beforeAll(async () => {
    S = await mkAccount('acc_busca', { limit: null });
    const names = Array.from({ length: 500 }, (_, i) => (i % 10 === 0 ? `José Almeida ${i}` : `Maria Souza ${i}`));
    await owner.patient.createMany({
      data: names.map((n, i) => ({
        id: `busca_${i}`, accountId: 'acc_busca', fullName: n, normalizedName: normalizeName(n), phone: '11999990000',
        tags: i % 25 === 0 ? ['gestante'] : [], status: i % 50 === 0 ? ('ARCHIVED' as const) : ('ACTIVE' as const),
      })),
    });
  });

  it('com 500 pacientes, filtra por parte do nome ignorando acentos e maiúsculas, em até 1 segundo', async () => {
    await patients.list(S, { q: 'jose' }); // aquecimento
    const t0 = performance.now();
    const r = await patients.list(S, { q: 'JOSÉ alm', limit: 100 });
    const ms = performance.now() - t0;
    if (!r.ok) throw new Error();
    expect(r.total).toBe(40); // 50 "José" menos 10 arquivados
    expect(r.items.every((p) => p.fullName.startsWith('José Almeida'))).toBe(true);
    expect(ms).toBeLessThan(1000);
  });

  it('filtra por situação e por etiqueta', async () => {
    const archived = await patients.list(S, { status: 'ARCHIVED', limit: 100 });
    expect(archived.ok && archived.total).toBe(10);
    const tagged = await patients.list(S, { tag: 'Gestante', limit: 100 });
    expect(tagged.ok && tagged.items.every((p) => p.tags.includes('gestante'))).toBe(true);
    const all = await patients.list(S, { status: 'ALL', limit: 100 });
    expect(all.ok && all.total).toBe(500);
  });

  it('sem resultado devolve lista vazia sinalizada (a tela mostra o atalho para cadastrar)', async () => {
    const r = await patients.list(S, { q: 'ninguem com esse nome' });
    expect(r).toMatchObject({ ok: true, total: 0, empty: true, items: [] });
  });

  it('pagina por cursor, em ordem de nome, sem repetir nem perder pacientes', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await patients.list(S, { limit: 100, cursor });
      if (!r.ok) throw new Error();
      seen.push(...r.items.map((p) => p.id));
      cursor = r.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(490); // 500 pacientes menos 10 arquivados
    expect(new Set(seen).size).toBe(490);
  });
});

describe('US-PAC-03 · editar, arquivar, restaurar e excluir [e2e][api]', () => {
  const A = sess(TENANT_A);

  it('arquivar tira da lista padrão e preserva o histórico; restaurar traz de volta', async () => {
    const r = await patients.create(A, valid('Para Arquivar', { consent: true }));
    if (!r.ok) throw new Error();
    const id = r.patient.id;
    expect(await patients.archive(A, id)).toEqual({ ok: true });
    const def = await patients.list(A, { q: 'para arquivar' });
    expect(def.ok && def.total).toBe(0);
    const arch = await patients.list(A, { q: 'para arquivar', status: 'ARCHIVED' });
    expect(arch.ok && arch.total).toBe(1);
    expect(await owner.patientConsent.count({ where: { patientId: id } })).toBe(1); // histórico preservado
    expect(await patients.archive(A, id)).toEqual({ ok: false, reason: 'already_archived' });

    expect(await patients.restore(A, id)).toEqual({ ok: true });
    const back = await patients.get(A, id);
    expect(back.ok && back.patient.status).toBe('ACTIVE');
    expect(back.ok && back.consents).toHaveLength(1);
    expect(await patients.restore(A, id)).toEqual({ ok: false, reason: 'not_archived' });
  });

  it('edita campos, mantém a busca coerente e audita sem registrar valores', async () => {
    const r = await patients.create(A, valid('Nome Antigo'));
    if (!r.ok) throw new Error();
    const u = await patients.update(A, r.patient.id, { fullName: 'Nome Novo Ç', goal: 'hipertrofia', tags: ['Atleta'] });
    expect(u.ok && u.patient).toMatchObject({ fullName: 'Nome Novo Ç', goal: 'hipertrofia', tags: ['atleta'] });
    const found = await patients.list(A, { q: 'novo c' });
    expect(found.ok && found.items.map((p) => p.id)).toContain(r.patient.id);
    expect(await patients.update(A, r.patient.id, { phone: null })).toMatchObject({ ok: false, errors: ['contact_required'] });
    const log = await owner.auditLog.findFirstOrThrow({ where: { action: 'PATIENT_UPDATED', resourceId: r.patient.id } });
    expect(JSON.stringify(log)).not.toContain('hipertrofia');
  });

  it('editar o CPF para um já existente exige confirmação', async () => {
    await patients.create(A, valid('Dono do CPF', { cpf: '111.444.777-35' }));
    const other = await patients.create(A, valid('Outro Paciente'));
    if (!other.ok) throw new Error();
    expect(await patients.update(A, other.patient.id, { cpf: '11144477735' })).toMatchObject({ ok: false, reason: 'duplicate_cpf', needsConfirm: true });
    expect((await patients.update(A, other.patient.id, { cpf: '11144477735', confirmDuplicate: true })).ok).toBe(true);
  });

  it('excluir (LGPD) exige confirmação, remove em cascata e deixa de ser contado', async () => {
    const r = await patients.create(A, valid('Para Excluir Definitivo', { consent: true }));
    if (!r.ok) throw new Error();
    const id = r.patient.id;
    await adminDb.$executeRaw`SELECT refresh_usage_counters()`;
    const before = (await adminDb.usageCounter.findFirstOrThrow({ where: { accountId: TENANT_A }, orderBy: { date: 'desc' } })).patientsTotal;

    expect(await lgpd.executeDeletion(A, id, { mode: 'DELETE', confirm: false })).toMatchObject({ ok: false, reason: 'confirmation_required' });
    expect(await lgpd.executeDeletion(A, id, { mode: 'DELETE', confirm: true })).toMatchObject({ ok: true, purgeFailures: [] });
    expect(await owner.patientConsent.count({ where: { patientId: id } })).toBe(0);
    await adminDb.$executeRaw`SELECT refresh_usage_counters()`;
    const after = (await adminDb.usageCounter.findFirstOrThrow({ where: { accountId: TENANT_A }, orderBy: { date: 'desc' } })).patientsTotal;
    expect(after).toBe(before - 1);
  });
});

describe('US-PAC-04 · consentimento LGPD do paciente [api][e2e]', () => {
  const A = sess(TENANT_A);

  it('registra data e versão do termo; sem consentimento, a ficha e a lista exibem alerta', async () => {
    const r = await patients.create(A, valid('Sem Consentimento Ainda'));
    if (!r.ok) throw new Error();
    const id = r.patient.id;
    const g = await patients.get(A, id);
    expect(g.ok && g.alerts).toEqual(['consent_missing']);
    const l = await patients.list(A, { q: 'sem consentimento ainda' });
    expect(l.ok && l.items[0].consentMissing).toBe(true);

    const c = await patients.recordConsent(A, id);
    expect(c.ok && c.consent.version).toBe(PATIENT_CONSENT_VERSION);
    expect(c.ok && c.consent.grantedAt).toBeInstanceOf(Date);
    const g2 = await patients.get(A, id);
    expect(g2.ok && g2.alerts).toEqual([]);
    const l2 = await patients.list(A, { q: 'sem consentimento ainda' });
    expect(l2.ok && l2.items[0].consentMissing).toBe(false);
  });

  it('cadastrar já com consentimento grava o termo junto', async () => {
    const r = await patients.create(A, valid('Com Consentimento', { consent: true }));
    if (!r.ok) throw new Error();
    const g = await patients.get(A, r.patient.id);
    expect(g.ok && g.consents).toHaveLength(1);
    expect(g.ok && g.alerts).toEqual([]);
  });

  it('revogar traz o alerta de volta, e o histórico de consentimentos é mantido', async () => {
    const r = await patients.create(A, valid('Vai Revogar', { consent: true }));
    if (!r.ok) throw new Error();
    expect(await patients.revokeConsent(A, r.patient.id)).toEqual({ ok: true, revoked: 1 });
    const g = await patients.get(A, r.patient.id);
    expect(g.ok && g.alerts).toEqual(['consent_missing']);
    expect(g.ok && g.consents[0].revokedAt).toBeInstanceOf(Date);
  });

  it('os consentimentos entram na exportação LGPD do paciente', async () => {
    const r = await patients.create(A, valid('Para Exportar', { consent: true }));
    if (!r.ok) throw new Error();
    const exp = await lgpd.exportPatient(A, r.patient.id);
    if (!exp.ok) throw new Error();
    const d = await lgpd.downloadExport(A, exp.token);
    if (!d.ok) throw new Error();
    const json = JSON.parse(d.content);
    expect(json.secoes.consentimentos).toHaveLength(1);
    expect(json.secoes.consentimentos[0].version).toBe(PATIENT_CONSENT_VERSION);
  });
});

describe('US-ADM-02 · limites do plano [api][e2e]', () => {
  it('avisa aos 80% e no limite (uma vez cada), bloqueia o 11º cadastro e mantém o acesso aos existentes', async () => {
    const S = await mkAccount('acc_lim10', { limit: 10 });
    const to = 'acc_lim10@example.test';
    for (let i = 1; i <= 7; i++) expect((await patients.create(S, valid(`Lim ${i}`))).ok).toBe(true);
    expect(await notices('acc_lim10')).toEqual([]);

    await patients.create(S, valid('Lim 8')); // 80%
    expect(await notices('acc_lim10')).toEqual(['LIMIT_80']);
    expect(mails(to, 'limit_warning')).toHaveLength(1);
    await patients.create(S, valid('Lim 9'));
    expect(mails(to, 'limit_warning')).toHaveLength(1); // não repete

    await patients.create(S, valid('Lim 10')); // 100%
    expect(await notices('acc_lim10')).toEqual(['LIMIT_100', 'LIMIT_80']);
    expect(mails(to, 'limit_reached')).toHaveLength(1);

    const blocked = await patients.create(S, valid('Lim 11'));
    expect(blocked).toMatchObject({ ok: false, reason: 'patient_limit', limit: 10, count: 10, upgrade: true });
    expect(await count('acc_lim10')).toBe(10);

    // acesso aos pacientes existentes continua normal
    const list = await patients.list(S);
    expect(list.ok && list.total).toBe(10);
    const first = list.ok ? list.items[0].id : '';
    expect((await patients.get(S, first)).ok).toBe(true);
    expect((await patients.update(S, first, { goal: 'segue editando' })).ok).toBe(true);
  });

  it('arquivar libera vaga e rearma os avisos quando o uso volta abaixo de 80%', async () => {
    const S = sess('acc_lim10');
    const ids = (await owner.patient.findMany({ where: { accountId: 'acc_lim10', status: 'ACTIVE' }, orderBy: { fullName: 'asc' } })).map((p) => p.id);
    await patients.archive(S, ids[0]);
    expect(await notices('acc_lim10')).toEqual(['LIMIT_80']); // 9/10: sai o aviso de 100%
    expect((await patients.create(S, valid('Lim 11'))).ok).toBe(true);

    for (const id of ids.slice(1, 4)) await patients.archive(S, id); // 7/10
    expect(await notices('acc_lim10')).toEqual([]);
    await patients.create(S, valid('Lim 12'));
    await patients.create(S, valid('Lim 13')); // 9/10 de novo
    expect(mails('acc_lim10@example.test', 'limit_warning')).toHaveLength(2); // avisou de novo
  });

  it('restaurar também respeita o limite', async () => {
    const S = sess('acc_lim10');
    await patients.create(S, valid('Lim 14')); // 10/10
    const archived = await owner.patient.findFirstOrThrow({ where: { accountId: 'acc_lim10', status: 'ARCHIVED' } });
    expect(await patients.restore(S, archived.id)).toMatchObject({ ok: false, reason: 'patient_limit', upgrade: true });
  });

  it('o upgrade vale imediatamente', async () => {
    const S = sess('acc_lim10');
    expect((await patients.create(S, valid('Sem Vaga'))).ok).toBe(false);
    await setPlan('acc_lim10', 100);
    expect((await patients.create(S, valid('Com Vaga'))).ok).toBe(true);
  });

  it('cadastros simultâneos no limite: só entra o que cabe', async () => {
    const S = await mkAccount('acc_race', { limit: 5 });
    for (let i = 1; i <= 4; i++) await patients.create(S, valid(`Corrida ${i}`));
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => patients.create(S, valid(`Concorrente ${i}`))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'patient_limit')).toHaveLength(5);
    expect(await count('acc_race')).toBe(5);
  });

  it('excluir um paciente (LGPD) reavalia os avisos de limite', async () => {
    const S = await mkAccount('acc_lgpd_lim', { limit: 5 });
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) { const r = await patients.create(S, valid(`Del ${i}`)); if (r.ok) ids.push(r.patient.id); }
    expect(await notices('acc_lgpd_lim')).toEqual(['LIMIT_100', 'LIMIT_80']);
    await lgpd.executeDeletion(S, ids[0], { mode: 'DELETE', confirm: true });
    await lgpd.executeDeletion(S, ids[1], { mode: 'DELETE', confirm: true });
    expect(await notices('acc_lgpd_lim')).toEqual([]); // 3/5
  });

  it('plano sem limite nunca bloqueia nem avisa', async () => {
    const S = await mkAccount('acc_inf', { limit: null });
    for (let i = 1; i <= 12; i++) expect((await patients.create(S, valid(`Inf ${i}`))).ok).toBe(true);
    expect(await notices('acc_inf')).toEqual([]);
  });
});

describe('Situação da assinatura e novos cadastros [api]', () => {
  it('trial vencido: bloqueia cadastro e restauração, mas leitura e edição continuam', async () => {
    const S = await mkAccount('acc_trial_end', { status: 'TRIAL', trialEndsAt: new Date(Date.now() + DAY), limit: 15 });
    const ok = await patients.create(S, valid('Antes do Fim'));
    expect(ok.ok).toBe(true);
    await owner.account.update({ where: { id: 'acc_trial_end' }, data: { trialEndsAt: new Date(Date.now() - DAY) } });

    expect(await patients.create(S, valid('Depois do Fim'))).toMatchObject({ ok: false, reason: 'access_restricted', upgrade: true });
    const list = await patients.list(S);
    expect(list.ok && list.total).toBe(1);
    const id = ok.ok ? ok.patient.id : '';
    expect((await patients.update(S, id, { goal: 'continua editando' })).ok).toBe(true);
    expect((await patients.get(S, id)).ok).toBe(true);
    expect((await lgpd.exportPatient(S, id)).ok).toBe(true); // exportação segue disponível
  });

  it('atraso: normal na carência; depois da carência só novos cadastros são bloqueados', async () => {
    const inGrace = await mkAccount('acc_grace', { status: 'PAST_DUE', graceEndsAt: new Date(Date.now() + 3 * DAY) });
    expect((await patients.create(inGrace, valid('Na Carência'))).ok).toBe(true);
    const after = await mkAccount('acc_after_grace', { status: 'PAST_DUE', graceEndsAt: new Date(Date.now() - DAY) });
    expect(await patients.create(after, valid('Pós Carência'))).toMatchObject({ ok: false, reason: 'access_restricted' });
    const l = await patients.list(after);
    expect(l.ok).toBe(true);
  });

  it('conta suspensa: somente leitura', async () => {
    const S = await mkAccount('acc_susp', { status: 'SUSPENDED' });
    expect(await patients.create(S, valid('X'))).toMatchObject({ ok: false, reason: 'access_restricted' });
  });
});
