import { PatientConsultationPackageStatus, Prisma, PrismaClient } from '@prisma/client';
import type { SessionInfo } from '../auth/service';
import { withTenant } from '../db/tenant';

const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);

export interface CreatePackageInput {
  patientId: string;
  name: string;
  totalSessions: number;
  amountCents: number;
}

const fail = (reason: string) => ({ ok: false as const, reason });

/**
 * Package use is recorded in the same tenant transaction as the appointment
 * completion. The unique appointmentId constraint is the final idempotency guard.
 */
export async function consumeAppointmentPackage(
  tx: Prisma.TransactionClient,
  input: { accountId: string; appointmentId: string; patientId: string; actorUserId: string; now: Date },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'package-consume:' + input.accountId + ':' + input.patientId}))`;
  const existing = await tx.packageSession.findUnique({ where: { appointmentId: input.appointmentId } });
  if (existing) return { consumed: false as const, alreadyConsumed: true as const };

  const consultationPackage = await tx.patientConsultationPackage.findFirst({
    where: {
      patientId: input.patientId,
      status: PatientConsultationPackageStatus.ACTIVE,
      remainingSessions: { gt: 0 },
    },
    orderBy: [{ purchasedAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (!consultationPackage) return { consumed: false as const, alreadyConsumed: false as const };

  const updated = await tx.patientConsultationPackage.updateMany({
    where: { id: consultationPackage.id, status: 'ACTIVE', remainingSessions: { gt: 0 } },
    data: { remainingSessions: { decrement: 1 } },
  });
  if (!updated.count) return { consumed: false as const, alreadyConsumed: false as const };

  const balance = await tx.patientConsultationPackage.findUnique({
    where: { id: consultationPackage.id },
    select: { remainingSessions: true },
  });
  if (balance?.remainingSessions === 0) {
    await tx.patientConsultationPackage.update({
      where: { id: consultationPackage.id },
      data: { status: PatientConsultationPackageStatus.COMPLETED },
    });
  }

  await tx.packageSession.create({
    data: {
      accountId: input.accountId,
      packageId: consultationPackage.id,
      appointmentId: input.appointmentId,
      usedAt: input.now,
    },
  });
  await tx.auditLog.create({
    data: {
      accountId: input.accountId,
      actorUserId: input.actorUserId,
      action: 'PATIENT_PACKAGE_SESSION_USED',
      resource: 'PatientConsultationPackage',
      resourceId: consultationPackage.id,
      createdAt: input.now,
    },
  });
  return { consumed: true as const, alreadyConsumed: false as const, packageId: consultationPackage.id };
}

export function createPackagesService({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  async function create(session: SessionInfo, input: CreatePackageInput) {
    if (!CLINICAL.has(session.role)) return fail('forbidden');
    const name = input.name.trim();
    if (!name || name.length > 120 || !Number.isInteger(input.totalSessions) || input.totalSessions < 1 || input.totalSessions > 1000) {
      return fail('validation');
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100_000_000) {
      return fail('validation');
    }

    return withTenant(session.accountId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: input.patientId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!patient) return fail('patient_not_found');

      const createdAt = now();
      const consultationPackage = await tx.patientConsultationPackage.create({
        data: {
          accountId: session.accountId,
          patientId: patient.id,
          name,
          totalSessions: input.totalSessions,
          remainingSessions: input.totalSessions,
          amountCents: input.amountCents,
          status: PatientConsultationPackageStatus.ACTIVE,
          purchasedAt: createdAt,
          createdAt,
        },
      });
      await tx.auditLog.create({
        data: {
          accountId: session.accountId,
          actorUserId: session.userId,
          action: 'PATIENT_PACKAGE_CREATED',
          resource: 'PatientConsultationPackage',
          resourceId: consultationPackage.id,
          createdAt,
        },
      });
      return { ok: true as const, package: consultationPackage };
    }, db);
  }

  async function list(session: SessionInfo, patientId: string) {
    if (!CLINICAL.has(session.role)) return fail('forbidden');
    return withTenant(session.accountId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: patientId },
        select: { id: true },
      });
      if (!patient) return fail('patient_not_found');

      const packages = await tx.patientConsultationPackage.findMany({
        where: { patientId: patient.id },
        orderBy: [{ purchasedAt: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      const ids = packages.map((item) => item.id);
      const sessions = ids.length
        ? await tx.packageSession.findMany({
          where: { packageId: { in: ids } },
          select: { id: true, packageId: true, appointmentId: true, usedAt: true },
          orderBy: { usedAt: 'desc' },
        })
        : [];
      const usedByPackage = new Map<string, typeof sessions>();
      for (const used of sessions) usedByPackage.set(used.packageId, [...(usedByPackage.get(used.packageId) ?? []), used]);
      const active = packages.filter((item) => item.status === PatientConsultationPackageStatus.ACTIVE);
      return {
        ok: true as const,
        items: packages.map((item) => ({
          ...item,
          sessions: usedByPackage.get(item.id) ?? [],
        })),
        balance: {
          activePackages: active.length,
          remainingSessions: active.reduce((sum, item) => sum + item.remainingSessions, 0),
        },
      };
    }, db);
  }

  async function cancel(session: SessionInfo, packageId: string) {
    if (!CLINICAL.has(session.role)) return fail('forbidden');
    return withTenant(session.accountId, async (tx) => {
      const result = await tx.patientConsultationPackage.updateMany({
        where: { id: packageId, status: 'ACTIVE' },
        data: { status: PatientConsultationPackageStatus.CANCELED },
      });
      if (!result.count) {
        const existing = await tx.patientConsultationPackage.findUnique({ where: { id: packageId }, select: { id: true } });
        return fail(existing ? 'package_not_active' : 'package_not_found');
      }

      const canceledAt = now();
      await tx.auditLog.create({
        data: {
          accountId: session.accountId,
          actorUserId: session.userId,
          action: 'PATIENT_PACKAGE_CANCELED',
          resource: 'PatientConsultationPackage',
          resourceId: packageId,
          createdAt: canceledAt,
        },
      });
      return { ok: true as const };
    }, db);
  }

  return { create, list, cancel };
}
