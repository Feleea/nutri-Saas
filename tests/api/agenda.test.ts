import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { GET as me } from '@/app/api/me/route';
import { POST as createPatient } from '@/app/api/patients/route';
import { GET as listPatients } from '@/app/api/patients/route';
import { GET as listAgenda, POST as createAppt } from '@/app/api/agenda/route';
import { GET as getAppt } from '@/app/api/agenda/[id]/route';
import { POST as reschedule } from '@/app/api/agenda/[id]/reschedule/route';
import { POST as cancel } from '@/app/api/agenda/[id]/cancel/route';
import { POST as setStatus } from '@/app/api/agenda/[id]/status/route';
import { GET as searchAgendaPatients } from '@/app/api/agenda/patients/route';
import { GET as getSettings, POST as setSettings } from '@/app/api/settings/agenda/route';
import { POST as remindersJob } from '@/app/api/jobs/reminders/route';
import { POST as dailyJob } from '@/app/api/jobs/daily/route';
import { call, cookieOf, tokenFrom, mailer } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function tenant(prefix: string) {
  const email = uniq(prefix);
  await call(signup, { body: { accountName: prefix, userName: prefix, email, password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true } });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const { accountId, userId } = (await call(me, { method: 'GET', cookie })).json;
  const user = await owner.user.findUniqueOrThrow({ where: { email } });
  const patient = async (name: string, extra: object = {}) =>
    (await call(createPatient, { cookie, body: { fullName: name, email: uniq('pac'), ...extra } })).json.patient.id as string;
  return { email, cookie, accountId, userId, patient, asRole: (role: 'TITULAR' | 'SECRETARIA') => owner.membership.updateMany({ where: { userId: user.id }, data: { role } }) };
}
const jobHeaders = { 'x-job-secret': process.env.JOB_SECRET! };

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API · agenda [e2e][seg]', () => {
  it('agenda por data/hora locais, lista o dia no fuso da conta e devolve a consulta com lembrete', async () => {
    const t = await tenant('ag');
    const pid = await t.patient('Maria da Agenda');
    const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const c = await call(createAppt, { cookie: t.cookie, body: { patientId: pid, date, time: '10:00' } });
    expect(c.status).toBe(201);
    expect(c.json.appointment).toMatchObject({ patient: { name: 'Maria da Agenda' }, local: { time: '10:00', timezone: 'America/Sao_Paulo' }, durationMinutes: 50, reminder: { status: 'PENDING' } });

    const l = await call(listAgenda, { method: 'GET', cookie: t.cookie, url: `http://localhost/api/agenda?day=${c.json.appointment.local.date}` });
    expect(l.status).toBe(200);
    expect(l.json.items.map((i: any) => i.id)).toContain(c.json.appointment.id);
    expect((await call(getAppt, { method: 'GET', cookie: t.cookie, params: { id: c.json.appointment.id } })).json.appointment.id).toBe(c.json.appointment.id);
  });

  it('exige startsAt ou data + hora, e recusa passado, duração e link inválidos', async () => {
    const t = await tenant('val');
    const pid = await t.patient('Validação');
    expect((await call(createAppt, { cookie: t.cookie, body: { patientId: pid } })).status).toBe(400);
    const past = await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(-5) } });
    expect([past.status, past.json.error.code]).toEqual([422, 'in_the_past']);
    expect((await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(48), durationMinutes: 1 } })).json.error.errors).toEqual(['duration_invalid']);
    expect((await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(48), meetingUrl: 'http://x.test' } })).json.error.errors).toEqual(['meeting_url_invalid']);
    expect((await call(createAppt, { cookie: t.cookie, body: { patientId: 'nao_existe', startsAt: inHours(48) } })).status).toBe(404);
  });

  it('conflito volta 409 com a consulta em choque; confirmar agenda mesmo assim; reagendar, confirmar e cancelar', async () => {
    const t = await tenant('cf');
    const a = await t.patient('Primeira'), b = await t.patient('Segunda');
    const start = inHours(72);
    const first = await call(createAppt, { cookie: t.cookie, body: { patientId: a, startsAt: start } });
    const clash = await call(createAppt, { cookie: t.cookie, body: { patientId: b, startsAt: start } });
    expect([clash.status, clash.json.error.code, clash.json.error.needsConfirm]).toEqual([409, 'conflict', true]);
    expect(clash.json.error.conflicts[0]).toMatchObject({ id: first.json.appointment.id, patientName: 'Primeira' });
    const forced = await call(createAppt, { cookie: t.cookie, body: { patientId: b, startsAt: start, confirmConflict: true } });
    expect(forced.status).toBe(201);

    const id = forced.json.appointment.id;
    expect((await call(setStatus, { cookie: t.cookie, params: { id }, body: { status: 'CONFIRMED' } })).status).toBe(200);
    const moved = await call(reschedule, { cookie: t.cookie, params: { id }, body: { startsAt: inHours(120) } });
    expect(moved.json.appointment.status).toBe('SCHEDULED');
    expect((await call(cancel, { cookie: t.cookie, params: { id }, body: { reason: '' } })).status).toBe(422);
    expect((await call(cancel, { cookie: t.cookie, params: { id }, body: { reason: 'sem condições de comparecer' } })).status).toBe(200);
    expect((await call(cancel, { cookie: t.cookie, params: { id }, body: { reason: 'de novo' } })).json.error.code).toBe('not_editable');
    const hist = await call(getAppt, { method: 'GET', cookie: t.cookie, params: { id } });
    expect(hist.json.history.map((h: any) => h.kind)).toEqual(['STATUS', 'RESCHEDULED', 'CANCELED']);
  });

  it('um tenant não acessa a agenda de outro', async () => {
    const a = await tenant('iso-a'), b = await tenant('iso-b');
    const pid = await a.patient('Só do A');
    const id = (await call(createAppt, { cookie: a.cookie, body: { patientId: pid, startsAt: inHours(48) } })).json.appointment.id;
    expect((await call(getAppt, { method: 'GET', cookie: b.cookie, params: { id } })).status).toBe(404);
    expect((await call(reschedule, { cookie: b.cookie, params: { id }, body: { startsAt: inHours(96) } })).status).toBe(404);
    expect((await call(cancel, { cookie: b.cookie, params: { id }, body: { reason: 'x' } })).status).toBe(404);
    const lb = await call(listAgenda, { method: 'GET', cookie: b.cookie, url: `http://localhost/api/agenda?from=${encodeURIComponent(inHours(0))}&to=${encodeURIComponent(inHours(24 * 30))}` });
    expect(lb.text).not.toContain('Só do A');
    expect((await call(createAppt, { cookie: b.cookie, body: { patientId: pid, startsAt: inHours(48) } })).status).toBe(404);
  });

  it('a secretária gerencia a agenda, mas continua sem acesso a pacientes; sem sessão, nada funciona', async () => {
    const t = await tenant('sec');
    const pid = await t.patient('Paciente da Secretária', { goal: 'META-SECRETA' });
    const id = (await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(48) } })).json.appointment.id;

    // um profissional para a secretária poder marcar novas consultas
    await owner.user.create({ data: { id: `${t.accountId}_prof`, email: uniq('prof'), passwordHash: 'x', name: 'Dra. Profissional' } });
    await owner.membership.create({ data: { accountId: t.accountId, userId: `${t.accountId}_prof`, role: 'PROFISSIONAL' } });
    await t.asRole('SECRETARIA');

    const l = await call(listAgenda, { method: 'GET', cookie: t.cookie, url: `http://localhost/api/agenda?from=${encodeURIComponent(inHours(0))}&to=${encodeURIComponent(inHours(24 * 10))}` });
    expect(l.status).toBe(200);
    expect(l.text).toContain('Paciente da Secretária');
    expect(l.text).not.toContain('META-SECRETA');
    expect((await call(searchAgendaPatients, { method: 'GET', cookie: t.cookie, url: 'http://localhost/api/agenda/patients?q=secret' })).json.patients).toEqual([{ id: pid, name: 'Paciente da Secretária' }]);

    const noProf = await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(96) } });
    expect([noProf.status, noProf.json.error.code]).toEqual([422, 'professional_required']);
    expect((await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(96), professionalUserId: `${t.accountId}_prof` } })).status).toBe(201);
    expect((await call(reschedule, { cookie: t.cookie, params: { id }, body: { startsAt: inHours(100) } })).status).toBe(200);

    expect((await call(listPatients, { method: 'GET', cookie: t.cookie })).status).toBe(403);
    expect((await call(listAgenda, { method: 'GET' })).status).toBe(401);
    expect((await call(createAppt, { body: { patientId: pid, startsAt: inHours(48) } })).status).toBe(401);
  });

  it('configurações: só o titular muda o fuso, e a agenda passa a usar o novo fuso', async () => {
    const t = await tenant('cfg');
    expect((await call(getSettings, { method: 'GET', cookie: t.cookie })).json).toMatchObject({ timezone: 'America/Sao_Paulo', defaultAppointmentMinutes: 50, reminderLeadHours: 24 });
    expect((await call(setSettings, { cookie: t.cookie, body: { timezone: 'Mars/Olympus' } })).status).toBe(422);
    expect((await call(setSettings, { cookie: t.cookie, body: { timezone: 'Asia/Tokyo', reminderLeadHours: 48 } })).json).toMatchObject({ timezone: 'Asia/Tokyo', reminderLeadHours: 48 });
    const pid = await t.patient('No Japão');
    const r = await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: '2099-01-01T13:00:00Z' } });
    expect(r.json.appointment.local).toMatchObject({ date: '2099-01-01', time: '22:00', timezone: 'Asia/Tokyo' });
    await t.asRole('SECRETARIA');
    expect((await call(setSettings, { cookie: t.cookie, body: { timezone: 'America/Bahia' } })).status).toBe(403);
  });
});

describe('API · jobs agendados [seg]', () => {
  it('exigem o segredo do agendador: sem ele ou com segredo errado, 401', async () => {
    expect((await call(remindersJob, {})).status).toBe(401);
    expect((await call(remindersJob, { headers: { 'x-job-secret': 'errado' } })).status).toBe(401);
    expect((await call(dailyJob, {})).status).toBe(401);
    // um cookie de sessão não substitui o segredo
    const t = await tenant('job');
    expect((await call(remindersJob, { cookie: t.cookie })).status).toBe(401);
  });

  it('o job de lembretes envia os vencidos uma única vez', async () => {
    const t = await tenant('rem');
    const email = uniq('paciente-lembrete');
    const pid = await t.patient('Lembrete Já', { email });
    const c = await call(createAppt, { cookie: t.cookie, body: { patientId: pid, startsAt: inHours(3) } }); // lembrete vence agora
    expect(c.json.appointment.reminder.status).toBe('PENDING');

    const first = await call(remindersJob, { headers: jobHeaders });
    expect(first.status).toBe(200);
    expect(first.json.sent).toBeGreaterThanOrEqual(1);
    expect(mailer().outbox.filter((m) => m.to === email && m.kind === 'appointment_reminder')).toHaveLength(1);
    await call(remindersJob, { headers: jobHeaders });
    expect(mailer().outbox.filter((m) => m.to === email && m.kind === 'appointment_reminder')).toHaveLength(1);
    expect((await call(getAppt, { method: 'GET', cookie: t.cookie, params: { id: c.json.appointment.id } })).json.appointment.reminder.status).toBe('SENT');
  });

  it('a rotina diária atualiza contadores e avisos de carência', async () => {
    const r = await call(dailyJob, { headers: jobHeaders });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(typeof r.json.graceEndedNotices).toBe('number');
    expect(await owner.usageCounter.count()).toBeGreaterThan(0);
  });
});
