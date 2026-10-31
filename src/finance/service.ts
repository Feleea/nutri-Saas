import { PrismaClient, type ChargeStatus, type PaymentMethod } from '@prisma/client';
import type { SessionInfo } from '../auth/service';
import { forTenant, withTenant } from '../db/tenant';
import { localParts, zonedToUtc } from '../agenda/time';
import { normalizeName } from '../foods/normalize';

const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);

export interface CreateChargeInput {
  patientId: string;
  appointmentId?: string | null;
  description: string;
  amountCents: number;
  paymentMethod: PaymentMethod;
  status: ChargeStatus;
  occurredAt?: Date;
  paidAt?: Date | null;
}

export function createFinanceService({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);

  async function searchPatients(s: SessionInfo, q: string) {
    if (!CLINICAL.has(s.role)) return [];
    return tenant(s).patient.findMany({
      where: { status: 'ACTIVE', normalizedName: { contains: normalizeName(q) } },
      select: { id: true, fullName: true },
      orderBy: { normalizedName: 'asc' },
      take: 20,
    }).then((rows) => rows.map((row) => ({ id: row.id, name: row.fullName })));
  }

  async function appointmentsForPatient(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return [];
    return tenant(s).appointment.findMany({
      where: { patientId },
      select: { id: true, startsAt: true, status: true },
      orderBy: { startsAt: 'desc' },
      take: 50,
    });
  }

  async function create(s: SessionInfo, input: CreateChargeInput) {
    if (!CLINICAL.has(s.role)) return { ok: false as const, reason: 'forbidden' };
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100_000_000) {
      return { ok: false as const, reason: 'invalid_amount' };
    }
    if (input.status === 'PENDING' && input.paidAt) return { ok: false as const, reason: 'invalid_payment_date' };
    return withTenant(s.accountId, async (tx) => {
      const patient = await tx.patient.findFirst({ where: { id: input.patientId, status: 'ACTIVE' }, select: { id: true } });
      if (!patient) return { ok: false as const, reason: 'patient_not_found' };
      if (input.appointmentId) {
        const appointment = await tx.appointment.findFirst({
        where: { id: input.appointmentId, patientId: input.patientId },
        select: { id: true },
      });
        if (!appointment) return { ok: false as const, reason: 'appointment_not_found' };
      }
      const createdAt = now();
      const paidAt = input.status === 'PAID' ? input.paidAt ?? createdAt : null;
      const charge = await tx.charge.create({
        data: {
          accountId: s.accountId,
          patientId: input.patientId,
          appointmentId: input.appointmentId || null,
          description: input.description.trim(),
          amountCents: input.amountCents,
          paymentMethod: input.paymentMethod,
          status: input.status,
          occurredAt: input.occurredAt ?? createdAt,
          paidAt,
          createdAt,
        },
        include: { patient: { select: { fullName: true } }, appointment: { select: { startsAt: true } } },
      });
      await tx.auditLog.create({
        data: {
          accountId: s.accountId,
          actorUserId: s.userId,
          action: 'CHARGE_CREATED',
          resource: 'Charge',
          resourceId: charge.id,
          createdAt,
        },
      });
      return { ok: true as const, charge };
    }, db);
  }

  async function receive(s: SessionInfo, chargeId: string, paidAt = now()) {
    if (!CLINICAL.has(s.role)) return { ok: false as const, reason: 'forbidden' };
    return withTenant(s.accountId, async (tx) => {
      const updated = await tx.charge.updateMany({
        where: { id: chargeId, status: 'PENDING' },
        data: { status: 'PAID', paidAt },
      });
      if (!updated.count) return { ok: false as const, reason: 'charge_not_pending' };
      await tx.auditLog.create({
        data: {
          accountId: s.accountId,
          actorUserId: s.userId,
          action: 'CHARGE_RECEIVED',
          resource: 'Charge',
          resourceId: chargeId,
          createdAt: now(),
        },
      });
      return { ok: true as const };
    }, db);
  }

  async function list(s: SessionInfo, requestedMonth?: string) {
    if (!CLINICAL.has(s.role)) return { ok: false as const, reason: 'forbidden' };
    const dbt = tenant(s);
    const account = await dbt.account.findUniqueOrThrow({ where: { id: s.accountId }, select: { timezone: true } });
    const currentMonth = localParts(now(), account.timezone).date.slice(0, 7);
    const month = requestedMonth ?? currentMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false as const, reason: 'invalid_month' };
    const [year, monthNumber] = month.split('-').map(Number);
    const from = zonedToUtc(year, monthNumber, 1, 0, 0, account.timezone);
    const to = monthNumber === 12
      ? zonedToUtc(year + 1, 1, 1, 0, 0, account.timezone)
      : zonedToUtc(year, monthNumber + 1, 1, 0, 0, account.timezone);
    const [pending, received] = await Promise.all([
      dbt.charge.findMany({
        where: { status: 'PENDING', occurredAt: { gte: from, lt: to } },
        include: { patient: { select: { fullName: true } }, appointment: { select: { startsAt: true } } },
        orderBy: { occurredAt: 'desc' },
      }),
      dbt.charge.findMany({
        where: { status: 'PAID', paidAt: { gte: from, lt: to } },
        include: { patient: { select: { fullName: true } }, appointment: { select: { startsAt: true } } },
        orderBy: { paidAt: 'desc' },
      }),
    ]);
    const charges = [...pending, ...received].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return {
      ok: true as const,
      month,
      timezone: account.timezone,
      summary: {
        receivedCents: received.reduce((sum, item) => sum + item.amountCents, 0),
        pendingCents: pending.reduce((sum, item) => sum + item.amountCents, 0),
      },
      charges,
    };
  }

  return { create, receive, list, searchPatients, appointmentsForPatient };
}
