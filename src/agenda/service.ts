import { Prisma, PrismaClient, type AppointmentStatus } from '@prisma/client';
import { forTenant, withTenant } from '../db/tenant';
import type { SessionInfo } from '../auth/service';
import { accessMode } from '../billing/limits';
import { normalizeName } from '../foods/normalize';
import { consumeAppointmentPackage } from '../packages/service';
import type { PatientDataSource } from '../lgpd/service';
import { dayBoundsUtc, isValidTimeZone, localParts, parseLocal } from './time';
import { isWithinAvailability, validateAvailabilityRules, type AvailabilityRule } from './availability';

type Tx = Prisma.TransactionClient;

export const AGENDA_CONFIG = { minMinutes: 5, maxMinutes: 480, noReminderIfStartsInMinutes: 30, maxRangeDays: 62 };
const ACTIVE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED'];

export interface ConflictInfo { id: string; startsAt: Date; endsAt: Date; patientName: string }
export interface Fail {
  ok: false;
  reason: string;
  errors?: string[];
  needsConfirm?: true;
  conflicts?: ConflictInfo[];
}
const fail = (reason: string, extra: Partial<Fail> = {}): Fail => ({ ok: false, reason, ...extra });

export interface TimeInput {
  startsAt?: Date;
  /** Alternativa: data e hora locais, interpretadas no fuso da conta. */
  date?: string;
  time?: string;
}
export interface CreateInput extends TimeInput {
  patientId: string;
  durationMinutes?: number;
  professionalUserId?: string;
  online?: boolean;
  meetingUrl?: string | null;
  confirmConflict?: boolean;
}
export interface RescheduleInput extends TimeInput {
  durationMinutes?: number;
  confirmConflict?: boolean;
}

interface Deps {
  db: PrismaClient; // suasnutri_app
  now?: () => Date;
  config?: typeof AGENDA_CONFIG;
}

export interface AvailabilityRuleInput extends AvailabilityRule {}

/** Só dados de agenda: nada clínico (objetivo, anotações, contato) sai daqui. A secretária pode ver tudo isto. */
function dto(a: any, tz: string) {
  const start = localParts(a.startsAt, tz);
  const reminder = a.reminders?.[0] ?? null;
  return {
    id: a.id,
    patient: { id: a.patient.id, name: a.patient.fullName },
    professional: { id: a.professional.id, name: a.professional.name },
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    durationMinutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000),
    local: { timezone: tz, date: start.date, time: start.time, endTime: localParts(a.endsAt, tz).time },
    status: a.status,
    online: a.online,
    meetingUrl: a.meetingUrl,
    cancelReason: a.cancelReason,
    reminder: reminder && { status: reminder.status, reason: reminder.skipReason, sendAt: reminder.sendAt, sentAt: reminder.sentAt },
  };
}

const INCLUDE = {
  patient: { select: { id: true, fullName: true } },
  professional: { select: { id: true, name: true } },
  reminders: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

export function createAgendaService({ db, now = () => new Date(), config = AGENDA_CONFIG }: Deps) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);
  const lock = (tx: Tx, accountId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'agenda:' + accountId}))`;

  async function accountOf(tx: Tx, accountId: string) {
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const sub = await tx.subscription.findUnique({ where: { accountId } });
    const mode = accessMode({ accountStatus: account.status, trialEndsAt: account.trialEndsAt, graceEndsAt: sub?.graceEndsAt ?? null }, now());
    return { account, mode };
  }

  function resolveStart(i: TimeInput, tz: string): Date | null {
    if (i.startsAt) return Number.isNaN(i.startsAt.getTime()) ? null : i.startsAt;
    return i.date && i.time ? parseLocal(i.date, i.time, tz) : null;
  }

  async function findConflicts(tx: Tx, professionalUserId: string, start: Date, end: Date, excludeId?: string): Promise<ConflictInfo[]> {
    const rows = await tx.appointment.findMany({
      where: { professionalUserId, status: { in: ACTIVE }, startsAt: { lt: end }, endsAt: { gt: start }, ...(excludeId && { NOT: { id: excludeId } }) },
      include: { patient: { select: { fullName: true } } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, startsAt: r.startsAt, endsAt: r.endsAt, patientName: r.patient.fullName }));
  }

  /** Um lembrete por consulta e por horário. Já nasce "pulado" quando não há como ou por que enviar. */
  async function planReminder(tx: Tx, a: { id: string; accountId: string; startsAt: Date }, patient: { email: string | null; remindersOptOut: boolean }, leadHours: number) {
    const n = now();
    let status: 'PENDING' | 'SKIPPED' = 'PENDING';
    let skipReason: string | null = null;
    if (patient.remindersOptOut) [status, skipReason] = ['SKIPPED', 'opt_out'];
    else if (!patient.email) [status, skipReason] = ['SKIPPED', 'no_email'];
    else if (a.startsAt.getTime() - n.getTime() < config.noReminderIfStartsInMinutes * 60_000) [status, skipReason] = ['SKIPPED', 'too_late'];
    const ideal = new Date(a.startsAt.getTime() - leadHours * 3_600_000);
    await tx.reminder.create({
      data: { accountId: a.accountId, appointmentId: a.id, sendAt: ideal > n ? ideal : n, status, skipReason, createdAt: n },
    });
  }

  const cancelPendingReminders = (tx: Tx, appointmentId: string, reason: string) =>
    tx.reminder.updateMany({ where: { appointmentId, status: { in: ['PENDING', 'SENDING'] } }, data: { status: 'CANCELED', skipReason: reason } });

  const audit = (tx: Tx, s: SessionInfo, action: string, id: string) =>
    tx.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action, resource: 'Appointment', resourceId: id, createdAt: now() } });

  async function checkAppointmentWindow(tx: Tx, accountId: string, professionalUserId: string, startsAt: Date, endsAt: Date, timezone: string) {
    const dbx = tx as any;
    const [rules, block] = await Promise.all([
      dbx.appointmentAvailabilityRule.findMany({ where: { accountId } }),
      dbx.appointmentBlock.findFirst({
        where: {
          accountId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
          OR: [{ professionalUserId: null }, { professionalUserId }],
        },
        select: { id: true },
      }),
    ]);
    if (block) return fail('block_conflict');
    if (rules.length && !isWithinAvailability(startsAt, endsAt, timezone, rules, professionalUserId)) {
      return fail('outside_availability');
    }
    return null;
  }

  // ───────────── US-AGE-01: agendar ─────────────
  async function create(s: SessionInfo, input: CreateInput) {
    if (input.meetingUrl && !/^https:\/\/\S+$/.test(input.meetingUrl)) return fail('validation', { errors: ['meeting_url_invalid'] });
    if (input.durationMinutes !== undefined && !(Number.isInteger(input.durationMinutes) && input.durationMinutes >= config.minMinutes && input.durationMinutes <= config.maxMinutes)) {
      return fail('validation', { errors: ['duration_invalid'] });
    }
    return withTenant(s.accountId, async (tx): Promise<Fail | { ok: true; appointment: ReturnType<typeof dto> }> => {
      await lock(tx, s.accountId);
      const { account, mode } = await accountOf(tx, s.accountId);
      if (mode === 'READ_ONLY') return fail('access_restricted');

      const start = resolveStart(input, account.timezone);
      if (!start) return fail('validation', { errors: ['start_invalid'] });
      if (start.getTime() < now().getTime()) return fail('in_the_past');
      const minutes = input.durationMinutes ?? account.defaultAppointmentMinutes;
      const end = new Date(start.getTime() + minutes * 60_000);

      const patient = await tx.patient.findFirst({ where: { id: input.patientId, status: 'ACTIVE' } });
      if (!patient) return fail('patient_not_found');

      const professionalId = input.professionalUserId ?? (s.role !== 'SECRETARIA' ? s.userId : undefined);
      if (!professionalId) return fail('professional_required');
      const m = await tx.membership.findFirst({ where: { userId: professionalId, role: { in: ['TITULAR', 'PROFISSIONAL'] } } });
      if (!m) return fail('validation', { errors: ['professional_invalid'] });

      const windowFailure = await checkAppointmentWindow(tx, s.accountId, professionalId, start, end, account.timezone);
      if (windowFailure) return windowFailure;
      const conflicts = await findConflicts(tx, professionalId, start, end);
      if (conflicts.length && !input.confirmConflict) return fail('conflict', { needsConfirm: true, conflicts });

      const a = await tx.appointment.create({
        data: {
          accountId: s.accountId, patientId: patient.id, professionalUserId: professionalId, startsAt: start, endsAt: end,
          online: !!input.online || !!input.meetingUrl, meetingUrl: input.meetingUrl ?? null, createdByUserId: s.userId, createdAt: now(),
        },
      });
      await planReminder(tx, a, patient, account.reminderLeadHours);
      await audit(tx, s, 'APPOINTMENT_CREATED', a.id);
      const full = await tx.appointment.findUniqueOrThrow({ where: { id: a.id }, include: INCLUDE });
      return { ok: true, appointment: dto(full, account.timezone) };
    }, db);
  }

  // ───────────── US-AGE-02: reagendar e cancelar ─────────────
  async function reschedule(s: SessionInfo, id: string, input: RescheduleInput) {
    return withTenant(s.accountId, async (tx): Promise<Fail | { ok: true; appointment: ReturnType<typeof dto> }> => {
      await lock(tx, s.accountId);
      const { account, mode } = await accountOf(tx, s.accountId);
      if (mode === 'READ_ONLY') return fail('access_restricted');
      const cur = await tx.appointment.findUnique({ where: { id }, include: { patient: true } });
      if (!cur) return fail('not_found');
      if (!ACTIVE.includes(cur.status)) return fail('not_editable');

      const start = resolveStart(input, account.timezone);
      if (!start) return fail('validation', { errors: ['start_invalid'] });
      if (start.getTime() < now().getTime()) return fail('in_the_past');
      const minutes = input.durationMinutes ?? Math.round((cur.endsAt.getTime() - cur.startsAt.getTime()) / 60_000);
      if (!(minutes >= config.minMinutes && minutes <= config.maxMinutes)) return fail('validation', { errors: ['duration_invalid'] });
      const end = new Date(start.getTime() + minutes * 60_000);

      const windowFailure = await checkAppointmentWindow(tx, s.accountId, cur.professionalUserId, start, end, account.timezone);
      if (windowFailure) return windowFailure;
      const conflicts = await findConflicts(tx, cur.professionalUserId, start, end, id);
      if (conflicts.length && !input.confirmConflict) return fail('conflict', { needsConfirm: true, conflicts });

      await tx.appointmentHistory.create({
        data: { accountId: s.accountId, appointmentId: id, kind: 'RESCHEDULED', previousStartsAt: cur.startsAt, previousEndsAt: cur.endsAt, byUserId: s.userId, at: now() },
      });
      const a = await tx.appointment.update({ where: { id }, data: { startsAt: start, endsAt: end, status: 'SCHEDULED' } });
      await cancelPendingReminders(tx, id, 'rescheduled'); // o lembrete do horário antigo nunca sai
      await planReminder(tx, a, cur.patient, account.reminderLeadHours);
      await audit(tx, s, 'APPOINTMENT_RESCHEDULED', id);
      const full = await tx.appointment.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      return { ok: true, appointment: dto(full, account.timezone) };
    }, db);
  }

  /** O cancelamento exige motivo e a consulta continua no histórico com status cancelada. */
  async function cancel(s: SessionInfo, id: string, reason: string) {
    if (!reason?.trim()) return fail('validation', { errors: ['reason_required'] });
    return withTenant(s.accountId, async (tx): Promise<Fail | { ok: true }> => {
      await lock(tx, s.accountId);
      const { mode } = await accountOf(tx, s.accountId);
      if (mode === 'READ_ONLY') return fail('access_restricted');
      const cur = await tx.appointment.findUnique({ where: { id } });
      if (!cur) return fail('not_found');
      if (!ACTIVE.includes(cur.status)) return fail('not_editable');
      await tx.appointment.update({ where: { id }, data: { status: 'CANCELED', cancelReason: reason.trim() } });
      await tx.appointmentHistory.create({ data: { accountId: s.accountId, appointmentId: id, kind: 'CANCELED', reason: reason.trim(), byUserId: s.userId, at: now() } });
      await cancelPendingReminders(tx, id, 'canceled');
      await audit(tx, s, 'APPOINTMENT_CANCELED', id);
      return { ok: true };
    }, db);
  }

  /** Confirmar, marcar como realizada ou falta. "Realizada" conta como atividade do paciente (regra de paciente ativo). */
  async function setStatus(s: SessionInfo, id: string, status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW') {
    return withTenant(s.accountId, async (tx): Promise<Fail | { ok: true }> => {
      const cur = await tx.appointment.findUnique({ where: { id } });
      if (!cur) return fail('not_found');
      if (!ACTIVE.includes(cur.status) || (status === 'CONFIRMED' && cur.status === 'CONFIRMED')) return fail('not_editable');
      await tx.appointment.update({ where: { id }, data: { status } });
      await tx.appointmentHistory.create({ data: { accountId: s.accountId, appointmentId: id, kind: 'STATUS', reason: status, byUserId: s.userId, at: now() } });
      if (status !== 'CONFIRMED') await cancelPendingReminders(tx, id, status === 'COMPLETED' ? 'completed' : 'no_show');
      if (status === 'COMPLETED') {
        await consumeAppointmentPackage(tx, {
          accountId: s.accountId,
          appointmentId: id,
          patientId: cur.patientId,
          actorUserId: s.userId,
          now: now(),
        });
        const p = await tx.patient.findUnique({ where: { id: cur.patientId } });
        if (p && p.lastActivityAt < cur.startsAt) await tx.patient.update({ where: { id: p.id }, data: { lastActivityAt: cur.startsAt } });
      }
      await audit(tx, s, `APPOINTMENT_${status}`, id);
      return { ok: true };
    }, db);
  }

  // ───────────── Leitura (qualquer papel, inclusive secretária) ─────────────
  async function list(s: SessionInfo, o: { day?: string; from?: Date; to?: Date; professionalId?: string; status?: AppointmentStatus } = {}) {
    const t = tenant(s);
    const account = await t.account.findUniqueOrThrow({ where: { id: s.accountId } });
    const tz = account.timezone;
    let from: Date, to: Date;
    if (o.from && o.to) {
      if (o.to <= o.from || o.to.getTime() - o.from.getTime() > config.maxRangeDays * 86_400_000) return fail('validation', { errors: ['range_invalid'] });
      [from, to] = [o.from, o.to];
    } else {
      const b = dayBoundsUtc(o.day ?? localParts(now(), tz).date, tz);
      if (!b) return fail('validation', { errors: ['day_invalid'] });
      [from, to] = [b.from, b.to];
    }
    const rows = await t.appointment.findMany({
      where: { startsAt: { gte: from, lt: to }, ...(o.professionalId && { professionalUserId: o.professionalId }), ...(o.status && { status: o.status }) },
      include: INCLUDE, orderBy: { startsAt: 'asc' }, take: 500,
    });
    return { ok: true as const, timezone: tz, items: rows.map((r) => dto(r, tz)) };
  }

  async function upcoming(s: SessionInfo, from: Date, to: Date) {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > config.maxRangeDays * 86_400_000) {
      return fail('validation', { errors: ['range_invalid'] });
    }
    const t = tenant(s);
    const account = await t.account.findUniqueOrThrow({ where: { id: s.accountId } });
    const where: Prisma.AppointmentWhereInput = { startsAt: { gte: from, lt: to }, status: { in: ACTIVE } };
    const [total, rows] = await Promise.all([
      t.appointment.count({ where }),
      t.appointment.findMany({ where, include: INCLUDE, orderBy: { startsAt: 'asc' }, take: 5 }),
    ]);
    return { ok: true as const, timezone: account.timezone, total, items: rows.map((r) => dto(r, account.timezone)) };
  }

  async function get(s: SessionInfo, id: string) {
    const t = tenant(s);
    const account = await t.account.findUniqueOrThrow({ where: { id: s.accountId } });
    const a = await t.appointment.findUnique({ where: { id }, include: { ...INCLUDE, history: { orderBy: { at: 'asc' } } } });
    if (!a) return fail('not_found');
    return {
      ok: true as const,
      appointment: dto(a, account.timezone),
      history: a.history.map((h) => ({
        kind: h.kind, reason: h.reason, at: h.at,
        previous: h.previousStartsAt && { startsAt: h.previousStartsAt, endsAt: h.previousEndsAt, local: localParts(h.previousStartsAt, account.timezone) },
      })),
    };
  }

  /** Busca mínima (id e nome) para a secretária marcar consultas sem abrir a ficha do paciente. */
  async function searchPatients(s: SessionInfo, q: string) {
    const rows = await tenant(s).patient.findMany({
      where: { status: 'ACTIVE', normalizedName: { contains: normalizeName(q) } },
      select: { id: true, fullName: true }, orderBy: { normalizedName: 'asc' }, take: 20,
    });
    return rows.map((p) => ({ id: p.id, name: p.fullName }));
  }

  // ───────────── Configurações da agenda ─────────────
  async function getSettings(s: SessionInfo) {
    const a = await tenant(s).account.findUniqueOrThrow({ where: { id: s.accountId } });
    return { timezone: a.timezone, defaultAppointmentMinutes: a.defaultAppointmentMinutes, reminderLeadHours: a.reminderLeadHours };
  }

  async function updateSettings(s: SessionInfo, p: { timezone?: string; defaultAppointmentMinutes?: number; reminderLeadHours?: number }) {
    if (s.role !== 'TITULAR') return fail('forbidden');
    const errors: string[] = [];
    if (p.timezone !== undefined && !isValidTimeZone(p.timezone)) errors.push('timezone_invalid');
    if (p.defaultAppointmentMinutes !== undefined && !(Number.isInteger(p.defaultAppointmentMinutes) && p.defaultAppointmentMinutes >= config.minMinutes && p.defaultAppointmentMinutes <= config.maxMinutes)) errors.push('duration_invalid');
    if (p.reminderLeadHours !== undefined && !(Number.isInteger(p.reminderLeadHours) && p.reminderLeadHours >= 1 && p.reminderLeadHours <= 168)) errors.push('lead_invalid');
    if (errors.length) return fail('validation', { errors });
    await tenant(s).account.update({ where: { id: s.accountId }, data: p });
    return { ok: true as const, settings: await getSettings(s) };
  }

  async function getAvailabilitySettings(s: SessionInfo) {
    if (s.role !== 'TITULAR') return fail('forbidden');
    const t = tenant(s) as any;
    const [rules, blocks, professionals] = await Promise.all([
      t.appointmentAvailabilityRule.findMany({
        where: { accountId: s.accountId }, include: { professional: { select: { id: true, name: true } } },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      t.appointmentBlock.findMany({
        where: { accountId: s.accountId, endsAt: { gte: now() } },
        include: { professional: { select: { id: true, name: true } } },
        orderBy: { startsAt: 'asc' }, take: 200,
      }),
      t.membership.findMany({
        where: { accountId: s.accountId, role: { in: ['TITULAR', 'PROFISSIONAL'] } },
        include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      ok: true as const,
      rules: rules.map(({ professional, ...rule }: any) => ({ ...rule, professionalName: professional?.name ?? null })),
      blocks: blocks.map(({ professional, ...block }: any) => ({ ...block, professionalName: professional?.name ?? null })),
      professionals: professionals.map((m: any) => ({ id: m.user.id, name: m.user.name })),
    };
  }

  async function saveAvailabilityRules(s: SessionInfo, input: AvailabilityRuleInput[]) {
    if (s.role !== 'TITULAR') return fail('forbidden');
    const errors = validateAvailabilityRules(input);
    if (errors.length) return fail('validation', { errors });
    const professionalIds = [...new Set(input.flatMap((rule) => rule.professionalUserId ? [rule.professionalUserId] : []))];
    return withTenant(s.accountId, async (tx) => {
      await lock(tx, s.accountId);
      if (professionalIds.length) {
        const valid = await tx.membership.findMany({
          where: { accountId: s.accountId, userId: { in: professionalIds }, role: { in: ['TITULAR', 'PROFISSIONAL'] } },
          select: { userId: true },
        });
        if (valid.length !== professionalIds.length) return fail('validation', { errors: ['professional_invalid'] });
      }
      const dbx = tx as any;
      await dbx.appointmentAvailabilityRule.deleteMany({ where: { accountId: s.accountId } });
      if (input.length) {
        await dbx.appointmentAvailabilityRule.createMany({
          data: input.map((rule) => ({ ...rule, accountId: s.accountId })),
        });
      }
      await audit(tx, s, 'APPOINTMENT_AVAILABILITY_UPDATED', s.accountId);
      return { ok: true as const };
    }, db).then(async (r) => r.ok ? getAvailabilitySettings(s) : r);
  }

  async function createBlock(s: SessionInfo, input: {
    startsAt: Date; endsAt: Date; professionalUserId?: string | null; reason?: string | null;
  }) {
    if (s.role !== 'TITULAR') return fail('forbidden');
    const reason = input.reason?.trim() || null;
    const duration = input.endsAt.getTime() - input.startsAt.getTime();
    if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime()) ||
      duration <= 0 || duration > config.maxRangeDays * 86_400_000 ||
      input.startsAt.getTime() < now().getTime() || (reason && reason.length > 200)) {
      return fail('validation', { errors: ['block_invalid'] });
    }
    const professionalUserId = input.professionalUserId || null;
    return withTenant(s.accountId, async (tx) => {
      await lock(tx, s.accountId);
      if (professionalUserId) {
        const member = await tx.membership.findFirst({
          where: { accountId: s.accountId, userId: professionalUserId, role: { in: ['TITULAR', 'PROFISSIONAL'] } },
          select: { id: true },
        });
        if (!member) return fail('validation', { errors: ['professional_invalid'] });
      }
      const appointment = await tx.appointment.findFirst({
        where: {
          status: { in: ACTIVE }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt },
          ...(professionalUserId && { professionalUserId }),
        },
        select: { id: true },
      });
      if (appointment) return fail('block_conflict');
      const block = await (tx as any).appointmentBlock.create({
        data: {
          accountId: s.accountId, professionalUserId, startsAt: input.startsAt, endsAt: input.endsAt,
          reason, createdByUserId: s.userId, createdAt: now(),
        },
      });
      await audit(tx, s, 'APPOINTMENT_BLOCK_CREATED', block.id);
      return { ok: true as const };
    }, db).then(async (r) => r.ok ? getAvailabilitySettings(s) : r);
  }

  async function deleteBlock(s: SessionInfo, id: string) {
    if (s.role !== 'TITULAR') return fail('forbidden');
    return withTenant(s.accountId, async (tx) => {
      await lock(tx, s.accountId);
      const dbx = tx as any;
      const block = await dbx.appointmentBlock.findFirst({ where: { id, accountId: s.accountId }, select: { id: true } });
      if (!block) return fail('not_found');
      await dbx.appointmentBlock.delete({ where: { id } });
      await audit(tx, s, 'APPOINTMENT_BLOCK_DELETED', id);
      return { ok: true as const };
    }, db).then(async (r) => r.ok ? getAvailabilitySettings(s) : r);
  }

  return {
    create, reschedule, cancel, setStatus, list, upcoming, get, searchPatients, getSettings, updateSettings,
    getAvailabilitySettings, saveAvailabilityRules, createBlock, deleteBlock,
  };
}

/** As consultas entram na exportação LGPD do paciente (sem dados de outras pessoas). */
export const appointmentDataSource: PatientDataSource = {
  name: 'consultas',
  collect: (t, patientId) =>
    t.appointment.findMany({ where: { patientId }, select: { startsAt: true, endsAt: true, status: true, online: true, cancelReason: true }, orderBy: { startsAt: 'asc' } }),
};
