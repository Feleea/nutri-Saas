import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type AccountStatus } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { createAgendaService, appointmentDataSource } from '../../src/agenda/service';
import { createReminderJob } from '../../src/agenda/reminders';
import { createPatientService } from '../../src/patients/service';
import { createLgpdService } from '../../src/lgpd/service';
import { MemoryMailer, type Mail, type Mailer } from '../../src/auth/mailer';
import { localParts, parseLocal } from '../../src/agenda/time';
import { normalizeName } from '../../src/foods/normalize';
import type { SessionInfo } from '../../src/auth/service';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const mailer = new MemoryMailer();
const agenda = createAgendaService({ db });
const patients = createPatientService({ db, mailer });
const DAY = 86_400_000, MIN = 60_000;
let clock = Date.now();
const job = createReminderJob({ db, mailer, now: () => new Date(clock) });

const sess = (id: string, who: 't' | 'p' | 's'): SessionInfo => ({ userId: `${id}_${who}`, accountId: id, role: who === 't' ? 'TITULAR' : who === 'p' ? 'PROFISSIONAL' : 'SECRETARIA' });
const SP = 'America/Sao_Paulo';
/** Instante futuro: hoje + N dias, no horário local HH:MM do fuso. */
const at = (days: number, hhmm: string, tz = SP) => parseLocal(localParts(new Date(Date.now() + days * DAY), tz).date, hhmm, tz)!;
const day = (d: Date, tz = SP) => localParts(d, tz).date;

async function mk(id: string, o: { tz?: string; status?: AccountStatus; trialEndsAt?: Date } = {}) {
  await owner.plan.upsert({ where: { id: 'plan_ag' }, update: {}, create: { id: 'plan_ag', code: 'plan_ag', name: 'ag', priceCents: 1, modules: ['CLINICO'] } });
  await owner.account.create({ data: { id, name: id, email: `${id}@example.test`, status: o.status ?? 'ACTIVE', trialEndsAt: o.trialEndsAt, timezone: o.tz ?? SP } });
  await owner.subscription.create({ data: { accountId: id, planId: 'plan_ag' } });
  for (const [w, role] of [['t', 'TITULAR'], ['p', 'PROFISSIONAL'], ['s', 'SECRETARIA']] as const) {
    await owner.user.create({ data: { id: `${id}_${w}`, email: `${id}_${w}@example.test`, passwordHash: 'x', name: `Prof ${w}` } });
    await owner.membership.create({ data: { accountId: id, userId: `${id}_${w}`, role } });
  }
}
const mkPatient = (accountId: string, id: string, name: string, o: { email?: string | null; optOut?: boolean; goal?: string } = {}) =>
  owner.patient.create({
    data: { id, accountId, fullName: name, normalizedName: normalizeName(name), phone: '11999990000', goal: o.goal,
      email: o.email === undefined ? `${id}@example.test` : o.email, remindersOptOut: o.optOut ?? false },
  });
const mails = (to: string) => mailer.outbox.filter((m) => m.to === to && m.kind === 'appointment_reminder');
const book = async (s: SessionInfo, patientId: string, start: Date, extra: object = {}) => {
  const r = await agenda.create(s, { patientId, startsAt: start, ...extra });
  if (!r.ok) throw new Error(`agendamento falhou: ${JSON.stringify(r)}`);
  return r.appointment;
};

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect()]); });

describe('US-AGE-01 · agendar consulta [e2e][api]', () => {
  const T = sess('ag1', 't');
  beforeAll(async () => { await mk('ag1'); await mkPatient('ag1', 'ag1_pa', 'Ana Paula'); await mkPatient('ag1', 'ag1_pb', 'Bruno Lima'); });

  it('aparece na agenda no fuso da conta, com duração padrão e paciente identificado', async () => {
    const a = await book(T, 'ag1_pa', at(3, '10:00'));
    expect(a).toMatchObject({ status: 'SCHEDULED', durationMinutes: 50, patient: { name: 'Ana Paula' }, local: { time: '10:00', endTime: '10:50', timezone: SP } });
    const list = await agenda.list(T, { day: a.local.date });
    expect(list.ok && list.items.map((i) => i.id)).toContain(a.id);
    expect(await owner.auditLog.count({ where: { action: 'APPOINTMENT_CREATED', resourceId: a.id } })).toBe(1);
  });

  it('a duração pode ser ajustada na criação e o padrão da conta é configurável', async () => {
    const custom = await book(T, 'ag1_pa', at(4, '10:00'), { durationMinutes: 30 });
    expect(custom.durationMinutes).toBe(30);
    expect((await agenda.updateSettings(T, { defaultAppointmentMinutes: 40 })).ok).toBe(true);
    expect((await book(T, 'ag1_pa', at(4, '15:00'))).durationMinutes).toBe(40);
    expect(await agenda.updateSettings(T, { defaultAppointmentMinutes: 1 })).toMatchObject({ ok: false, errors: ['duration_invalid'] });
    await agenda.updateSettings(T, { defaultAppointmentMinutes: 50 });
  });

  it('o fuso é o da conta: mudar o fuso muda a exibição, não o instante', async () => {
    const start = at(6, '10:00');
    const a = await book(T, 'ag1_pa', start);
    expect(a.local.time).toBe('10:00');
    expect(await agenda.updateSettings(sess('ag1', 'p'), { timezone: 'Asia/Tokyo' })).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(await agenda.updateSettings(T, { timezone: 'Mars/Olympus' })).toMatchObject({ errors: ['timezone_invalid'] });
    await agenda.updateSettings(T, { timezone: 'Asia/Tokyo' });
    const g = await agenda.get(T, a.id);
    expect(g.ok && g.appointment.local).toMatchObject({ time: '22:00', timezone: 'Asia/Tokyo' });
    expect(g.ok && g.appointment.startsAt.getTime()).toBe(start.getTime());
    await agenda.updateSettings(T, { timezone: SP });
  });

  it('data e hora locais também são aceitas (interpretadas no fuso da conta)', async () => {
    const d = day(at(8, '09:00'));
    const r = await agenda.create(T, { patientId: 'ag1_pb', date: d, time: '09:00' });
    expect(r.ok && r.appointment.local).toMatchObject({ date: d, time: '09:00' });
    expect(await agenda.create(T, { patientId: 'ag1_pb', date: '2026-02-31', time: '09:00' })).toMatchObject({ ok: false, errors: ['start_invalid'] });
  });

  it('conflito com outra consulta do mesmo profissional avisa e só agenda com confirmação', async () => {
    const first = await book(T, 'ag1_pa', at(10, '10:00'));
    const clash = await agenda.create(T, { patientId: 'ag1_pb', startsAt: at(10, '10:30') });
    expect(clash).toMatchObject({ ok: false, reason: 'conflict', needsConfirm: true });
    expect(clash.ok === false && clash.conflicts).toEqual([expect.objectContaining({ id: first.id, patientName: 'Ana Paula' })]);
    expect(await owner.appointment.count({ where: { patientId: 'ag1_pb', startsAt: at(10, '10:30') } })).toBe(0);
    expect((await agenda.create(T, { patientId: 'ag1_pb', startsAt: at(10, '10:30'), confirmConflict: true })).ok).toBe(true);
  });

  it('horários encostados, outro profissional ou consulta cancelada não geram conflito', async () => {
    await book(T, 'ag1_pa', at(11, '10:00'));
    expect((await agenda.create(T, { patientId: 'ag1_pb', startsAt: at(11, '10:50') })).ok).toBe(true); // começa quando a outra termina
    const other = await agenda.create(T, { patientId: 'ag1_pb', startsAt: at(11, '10:10'), professionalUserId: 'ag1_p' });
    expect(other.ok).toBe(true); // outro profissional
    const c = await book(T, 'ag1_pa', at(12, '10:00'));
    await agenda.cancel(T, c.id, 'paciente avisou');
    expect((await agenda.create(T, { patientId: 'ag1_pb', startsAt: at(12, '10:00') })).ok).toBe(true);
  });

  it('recusa horário no passado, duração inválida, link que não é https e paciente inexistente/arquivado/de outro tenant', async () => {
    expect(await agenda.create(T, { patientId: 'ag1_pa', startsAt: new Date(Date.now() - DAY) })).toMatchObject({ ok: false, reason: 'in_the_past' });
    expect(await agenda.create(T, { patientId: 'ag1_pa', startsAt: at(15, '10:00'), durationMinutes: 9999 })).toMatchObject({ errors: ['duration_invalid'] });
    expect(await agenda.create(T, { patientId: 'ag1_pa', startsAt: at(15, '10:00'), meetingUrl: 'http://x.test' })).toMatchObject({ errors: ['meeting_url_invalid'] });
    expect(await agenda.create(T, { patientId: 'nao_existe', startsAt: at(15, '10:00') })).toMatchObject({ reason: 'patient_not_found' });
    await mk('ag1b');
    await mkPatient('ag1b', 'ag1b_p', 'Do Outro Tenant');
    expect(await agenda.create(T, { patientId: 'ag1b_p', startsAt: at(15, '10:00') })).toMatchObject({ reason: 'patient_not_found' });
    await mkPatient('ag1', 'ag1_arq', 'Arquivado');
    await owner.patient.update({ where: { id: 'ag1_arq' }, data: { status: 'ARCHIVED' } });
    expect(await agenda.create(T, { patientId: 'ag1_arq', startsAt: at(15, '10:00') })).toMatchObject({ reason: 'patient_not_found' });
  });

  it('consulta online guarda o link', async () => {
    const a = await book(T, 'ag1_pa', at(16, '10:00'), { online: true, meetingUrl: 'https://meet.example.test/abc' });
    expect(a).toMatchObject({ online: true, meetingUrl: 'https://meet.example.test/abc' });
  });

  it('conta em somente leitura (trial vencido) não agenda, mas continua lendo', async () => {
    await mk('ag_ro', { status: 'TRIAL', trialEndsAt: new Date(Date.now() - DAY) });
    await mkPatient('ag_ro', 'ag_ro_p', 'Paciente RO');
    const S = sess('ag_ro', 't');
    expect(await agenda.create(S, { patientId: 'ag_ro_p', startsAt: at(3, '10:00') })).toMatchObject({ ok: false, reason: 'access_restricted' });
    expect((await agenda.list(S)).ok).toBe(true);
  });

  it('um tenant não vê nem altera a agenda de outro', async () => {
    await mk('ag2');
    const a = await book(T, 'ag1_pa', at(20, '10:00'));
    const B = sess('ag2', 't');
    const l = await agenda.list(B, { day: a.local.date });
    expect(l.ok && l.items).toEqual([]);
    expect(await agenda.get(B, a.id)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await agenda.reschedule(B, a.id, { startsAt: at(21, '10:00') })).toMatchObject({ reason: 'not_found' });
    expect(await agenda.cancel(B, a.id, 'x')).toMatchObject({ reason: 'not_found' });
    expect(await agenda.setStatus(B, a.id, 'CONFIRMED')).toMatchObject({ reason: 'not_found' });
    expect((await owner.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('SCHEDULED');
  });
});

describe('US-AGE-02 · reagendar e cancelar [api]', () => {
  const T = sess('ag3', 't');
  beforeAll(async () => { await mk('ag3'); await mkPatient('ag3', 'ag3_pa', 'Carla Dias'); await mkPatient('ag3', 'ag3_pb', 'Diego Reis'); });

  it('reagendar muda a data, guarda a anterior no histórico e mantém a duração', async () => {
    const a = await book(T, 'ag3_pa', at(3, '10:00'), { durationMinutes: 30 });
    await agenda.setStatus(T, a.id, 'CONFIRMED');
    const r = await agenda.reschedule(T, a.id, { startsAt: at(5, '14:00') });
    expect(r.ok && r.appointment).toMatchObject({ status: 'SCHEDULED', durationMinutes: 30, local: { time: '14:00', endTime: '14:30' } });
    const g = await agenda.get(T, a.id);
    expect(g.ok && g.history.find((h) => h.kind === 'RESCHEDULED')?.previous?.local).toEqual({ date: day(at(3, '10:00')), time: '10:00' });
  });

  it('reagendar também avisa conflito, mas a própria consulta não conflita consigo', async () => {
    const x = await book(T, 'ag3_pa', at(7, '10:00'));
    await book(T, 'ag3_pb', at(7, '11:00'));
    expect(await agenda.reschedule(T, x.id, { startsAt: at(7, '11:10') })).toMatchObject({ ok: false, reason: 'conflict', needsConfirm: true });
    expect((await agenda.reschedule(T, x.id, { startsAt: at(7, '10:05') })).ok).toBe(true); // sobrepõe o próprio horário antigo
    expect(await agenda.reschedule(T, x.id, { startsAt: new Date(Date.now() - DAY) })).toMatchObject({ reason: 'in_the_past' });
  });

  it('cancelar exige motivo, mantém a consulta no histórico como cancelada e impede nova edição', async () => {
    const a = await book(T, 'ag3_pa', at(9, '10:00'));
    expect(await agenda.cancel(T, a.id, '  ')).toMatchObject({ ok: false, errors: ['reason_required'] });
    expect((await agenda.cancel(T, a.id, 'Paciente viajou')).ok).toBe(true);
    const canceled = await agenda.list(T, { day: a.local.date, status: 'CANCELED' });
    expect(canceled.ok && canceled.items[0]).toMatchObject({ id: a.id, status: 'CANCELED', cancelReason: 'Paciente viajou' });
    expect(await agenda.cancel(T, a.id, 'de novo')).toMatchObject({ reason: 'not_editable' });
    expect(await agenda.reschedule(T, a.id, { startsAt: at(10, '10:00') })).toMatchObject({ reason: 'not_editable' });
    const g = await agenda.get(T, a.id);
    expect(g.ok && g.history.map((h) => h.kind)).toEqual(['CANCELED']);
  });

  it('o lembrete do horário antigo nunca sai; o do novo horário sai no prazo', async () => {
    await mkPatient('ag3', 'ag3_pc', 'Elisa Prado', { email: 'elisa@example.test' });
    const a = await book(T, 'ag3_pc', at(3, '10:00'));
    const old = a.startsAt;
    const moved = at(5, '10:00');
    await agenda.reschedule(T, a.id, { startsAt: moved });

    const rows = await owner.reminder.findMany({ where: { appointmentId: a.id }, orderBy: [{ createdAt: 'asc' }, { sendAt: 'asc' }] });
    expect(rows.map((r) => [r.status, r.skipReason])).toEqual([['CANCELED', 'rescheduled'], ['PENDING', null]]);

    clock = old.getTime() - 23 * 60 * MIN; // janela do lembrete ANTIGO
    await job.run();
    expect(mails('elisa@example.test')).toHaveLength(0);
    clock = moved.getTime() - 23 * 60 * MIN; // janela do novo
    await job.run();
    expect(mails('elisa@example.test')).toHaveLength(1);
    expect(mails('elisa@example.test')[0].text).toContain(day(moved).split('-').reverse().join('/'));
  });

  it('cancelar também cancela o lembrete pendente', async () => {
    await mkPatient('ag3', 'ag3_pd', 'Fábio Nunes', { email: 'fabio@example.test' });
    const a = await book(T, 'ag3_pd', at(4, '09:00'));
    await agenda.cancel(T, a.id, 'desistiu');
    expect((await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } })).status).toBe('CANCELED');
    clock = a.startsAt.getTime() - 23 * 60 * MIN;
    await job.run();
    expect(mails('fabio@example.test')).toHaveLength(0);
  });

  it('realizada conta como atividade do paciente; falta e realizada cancelam lembretes pendentes', async () => {
    await mkPatient('ag3', 'ag3_pe', 'Gil Moraes', { email: 'gil@example.test' });
    await owner.patient.update({ where: { id: 'ag3_pe' }, data: { lastActivityAt: new Date(Date.now() - 200 * DAY) } });
    const start = new Date(Date.now() - 2 * DAY);
    const past = await owner.appointment.create({ data: { id: 'ag3_past', accountId: 'ag3', patientId: 'ag3_pe', professionalUserId: 'ag3_t', startsAt: start, endsAt: new Date(start.getTime() + 50 * MIN), createdByUserId: 'ag3_t' } });
    expect((await agenda.setStatus(T, past.id, 'COMPLETED')).ok).toBe(true);
    expect((await owner.patient.findUniqueOrThrow({ where: { id: 'ag3_pe' } })).lastActivityAt.getTime()).toBe(start.getTime());
    expect(await agenda.setStatus(T, past.id, 'NO_SHOW')).toMatchObject({ reason: 'not_editable' });
  });
});

describe('US-AGE-03 · lembretes automáticos [api]', () => {
  const T = sess('ag4', 't');
  beforeAll(async () => {
    await mk('ag4');
    // o job é global: aqui só interessam os lembretes desta conta
    await owner.reminder.updateMany({ where: { status: 'PENDING', accountId: { not: 'ag4' } }, data: { status: 'CANCELED', skipReason: 'test_cleanup' } });
  });

  it('envia uma única vez, no prazo configurado, sem dados clínicos no texto', async () => {
    await mkPatient('ag4', 'ag4_p1', 'Helena Costa', { email: 'helena@example.test', goal: 'OBJETIVO-CONFIDENCIAL' });
    const a = await book(T, 'ag4_p1', at(3, '10:00'), { meetingUrl: 'https://meet.example.test/h' });
    const r = await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } });
    expect(r.status).toBe('PENDING');
    expect(r.sendAt.getTime()).toBe(a.startsAt.getTime() - 24 * 60 * MIN);

    clock = r.sendAt.getTime() - 5 * MIN; // ainda cedo
    await job.run();
    expect(mails('helena@example.test')).toHaveLength(0);

    clock = r.sendAt.getTime() + MIN;
    expect(await job.run()).toMatchObject({ sent: 1 });
    expect(await job.run()).toMatchObject({ sent: 0 }); // não repete
    const [m] = mails('helena@example.test');
    expect(m.text).toContain('10:00');
    expect(m.text).toContain('https://meet.example.test/h');
    expect(m.text).toContain(SP);
    expect(m.text).not.toContain('OBJETIVO-CONFIDENCIAL');
    const g = await agenda.get(T, a.id);
    expect(g.ok && g.appointment.reminder).toMatchObject({ status: 'SENT' });
  });

  it('paciente sem e-mail: a consulta indica que o lembrete não pôde ser enviado', async () => {
    await mkPatient('ag4', 'ag4_p2', 'Igor Sem Email', { email: null });
    const a = await book(T, 'ag4_p2', at(3, '11:00'));
    expect(a.reminder).toMatchObject({ status: 'SKIPPED', reason: 'no_email' });
  });

  it('paciente que pediu para não receber: nenhum envio', async () => {
    await mkPatient('ag4', 'ag4_p3', 'Joana Recusa', { email: 'joana@example.test', optOut: true });
    const a = await book(T, 'ag4_p3', at(3, '12:00'));
    expect(a.reminder).toMatchObject({ status: 'SKIPPED', reason: 'opt_out' });
    clock = a.startsAt.getTime() - 23 * 60 * MIN;
    await job.run();
    expect(mails('joana@example.test')).toHaveLength(0);
  });

  it('consulta muito próxima não gera lembrete', async () => {
    await mkPatient('ag4', 'ag4_p4', 'Kleber Urgente', { email: 'kleber@example.test' });
    const a = await book(T, 'ag4_p4', new Date(Date.now() + 10 * MIN));
    expect(a.reminder).toMatchObject({ status: 'SKIPPED', reason: 'too_late' });
  });

  it('falha de envio: tenta de novo com espera crescente e registra o resultado', async () => {
    class Flaky implements Mailer {
      fails = 2; sent: Mail[] = [];
      async send(m: Mail) { if (this.fails-- > 0) throw new Error('smtp fora do ar'); this.sent.push(m); }
    }
    const flaky = new Flaky();
    const j = createReminderJob({ db, mailer: flaky, now: () => new Date(clock) });
    await mkPatient('ag4', 'ag4_p5', 'Lara Retry', { email: 'lara@example.test' });
    const a = await book(T, 'ag4_p5', at(3, '13:00'));
    const rem = () => owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } });
    clock = (await rem()).sendAt.getTime() + MIN;
    const t0 = clock;

    expect(await j.run()).toMatchObject({ retried: 1, sent: 0 });
    let r = await rem();
    expect([r.status, r.attempts, r.lastError]).toEqual(['PENDING', 1, 'Error']);
    expect(r.sendAt.getTime()).toBe(t0 + 5 * MIN);

    clock = t0 + 2 * MIN; // ainda não venceu a espera
    expect(await j.run()).toMatchObject({ retried: 0, sent: 0 });
    clock = t0 + 6 * MIN;
    expect(await j.run()).toMatchObject({ retried: 1 });
    expect((await rem()).sendAt.getTime()).toBe(t0 + 6 * MIN + 10 * MIN); // dobra a espera
    clock = t0 + 20 * MIN;
    expect(await j.run()).toMatchObject({ sent: 1 });
    r = await rem();
    expect([r.status, r.attempts]).toEqual(['SENT', 3]);
    expect(flaky.sent).toHaveLength(1);
  });

  it('desiste depois de 3 falhas e marca como falhou', async () => {
    const broken: Mailer = { send: async () => { throw new Error('x'); } };
    const j = createReminderJob({ db, mailer: broken, now: () => new Date(clock) });
    await mkPatient('ag4', 'ag4_p6', 'Mauro Falha', { email: 'mauro@example.test' });
    const a = await book(T, 'ag4_p6', at(3, '14:00'));
    clock = (await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } })).sendAt.getTime() + MIN;
    for (let i = 0; i < 3; i++) { await j.run(); clock += 30 * MIN; }
    const r = await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } });
    expect([r.status, r.attempts]).toEqual(['FAILED', 3]);
  });

  it('execuções simultâneas do job enviam um único e-mail', async () => {
    await mkPatient('ag4', 'ag4_p7', 'Nina Paralela', { email: 'nina@example.test' });
    const a = await book(T, 'ag4_p7', at(3, '15:00'));
    clock = (await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } })).sendAt.getTime() + MIN;
    await Promise.all(Array.from({ length: 5 }, () => job.run()));
    expect(mails('nina@example.test')).toHaveLength(1);
    expect((await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } })).attempts).toBe(1);
  });

  it('paciente arquivado depois do agendamento: o lembrete é pulado', async () => {
    await mkPatient('ag4', 'ag4_p8', 'Otávio Arquivado', { email: 'otavio@example.test' });
    const a = await book(T, 'ag4_p8', at(3, '16:00'));
    await owner.patient.update({ where: { id: 'ag4_p8' }, data: { status: 'ARCHIVED' } });
    clock = a.startsAt.getTime() - 23 * 60 * MIN;
    await job.run();
    expect(mails('otavio@example.test')).toHaveLength(0);
    expect((await owner.reminder.findFirstOrThrow({ where: { appointmentId: a.id } })).skipReason).toBe('patient_archived');
  });

  it('processa vários tenants no mesmo ciclo, cada paciente só com a própria consulta', async () => {
    await mk('ag5'); await mk('ag6');
    await mkPatient('ag5', 'ag5_p', 'Paciente Cinco', { email: 'cinco@example.test' });
    await mkPatient('ag6', 'ag6_p', 'Paciente Seis', { email: 'seis@example.test' });
    const a5 = await book(sess('ag5', 't'), 'ag5_p', at(3, '10:00'));
    const a6 = await book(sess('ag6', 't'), 'ag6_p', at(3, '10:00'));
    clock = Math.min(a5.startsAt.getTime(), a6.startsAt.getTime()) - 23 * 60 * MIN;
    const r = await job.run();
    expect(r.sent).toBeGreaterThanOrEqual(2);
    expect(mails('cinco@example.test')).toHaveLength(1);
    expect(mails('seis@example.test')).toHaveLength(1);
    expect(mails('cinco@example.test')[0].text).not.toContain('Paciente Seis');
  });

  it('a função que localiza contas com lembretes devolve só ids de conta', async () => {
    await book(T, 'ag4_p1', at(30, '10:00')); // garante um lembrete pendente
    const rows = await db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM reminders_due_accounts(now() + interval '400 days')`;
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).toEqual(['account_id']);
  });
});

describe('US-AGE-06 · secretária vê a agenda sem o prontuário [seg]', () => {
  const T = sess('ag7', 't'), S = sess('ag7', 's');
  beforeAll(async () => {
    await mk('ag7');
    await mkPatient('ag7', 'ag7_p', 'Paciente Sigiloso', { email: 'sigiloso@example.test', goal: 'META-CLINICA-SECRETA' });
  });

  it('vê nome, horário, profissional e situação; nenhum dado clínico ou de contato aparece', async () => {
    const a = await book(T, 'ag7_p', at(3, '10:00'));
    const l = await agenda.list(S, { day: a.local.date });
    if (!l.ok) throw new Error();
    expect(l.items[0]).toMatchObject({ patient: { name: 'Paciente Sigiloso' }, local: { time: '10:00' }, status: 'SCHEDULED', professional: { name: 'Prof t' } });
    const json = JSON.stringify(l);
    for (const leak of ['META-CLINICA-SECRETA', 'sigiloso@example.test', '11999990000']) expect(json).not.toContain(leak);
  });

  it('não abre ficha, anamnese nem exportação; a busca para agendar devolve só id e nome', async () => {
    expect(await patients.get(S, 'ag7_p')).toEqual({ ok: false, reason: 'forbidden' });
    expect(await patients.list(S)).toEqual({ ok: false, reason: 'forbidden' });
    const found = await agenda.searchPatients(S, 'sigilo');
    expect(found).toEqual([{ id: 'ag7_p', name: 'Paciente Sigiloso' }]);
  });

  it('gerencia a agenda: agenda (indicando o profissional), reagenda, confirma e cancela', async () => {
    expect(await agenda.create(S, { patientId: 'ag7_p', startsAt: at(5, '10:00') })).toMatchObject({ ok: false, reason: 'professional_required' });
    expect(await agenda.create(S, { patientId: 'ag7_p', startsAt: at(5, '10:00'), professionalUserId: 'ag7_s' })).toMatchObject({ errors: ['professional_invalid'] });
    const r = await agenda.create(S, { patientId: 'ag7_p', startsAt: at(5, '10:00'), professionalUserId: 'ag7_t' });
    if (!r.ok) throw new Error();
    expect((await agenda.setStatus(S, r.appointment.id, 'CONFIRMED')).ok).toBe(true);
    expect((await agenda.reschedule(S, r.appointment.id, { startsAt: at(6, '10:00') })).ok).toBe(true);
    expect((await agenda.cancel(S, r.appointment.id, 'pedido do paciente')).ok).toBe(true);
  });

  it('as consultas entram na exportação LGPD do paciente', async () => {
    const lgpd = createLgpdService({ db, sources: [appointmentDataSource] });
    const exp = await lgpd.exportPatient(T, 'ag7_p');
    if (!exp.ok) throw new Error();
    const d = await lgpd.downloadExport(T, exp.token);
    if (!d.ok) throw new Error();
    expect(JSON.parse(d.content).secoes.consultas.length).toBeGreaterThanOrEqual(2);
  });
});
