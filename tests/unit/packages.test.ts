import { describe, expect, it, vi } from 'vitest';
import { consumeAppointmentPackage, createPackagesService } from '../../src/packages/service';
import type { SessionInfo } from '../../src/auth/service';

const session: SessionInfo = { userId: 'user-1', accountId: 'account-1', role: 'TITULAR' };
const fixedNow = new Date('2026-10-31T12:00:00Z');

function setup(tx: Record<string, any>) {
  const transaction = {
    ...tx,
    $executeRaw: vi.fn(),
  };
  const db = {
    $transaction: (fn: (value: any) => Promise<unknown>) => fn(transaction),
  } as any;
  return { service: createPackagesService({ db, now: () => fixedNow }), tx: transaction };
}

describe('consultation packages', () => {
  it('creates an active package for an active patient and audits it', async () => {
    const tx = {
      patient: { findFirst: vi.fn().mockResolvedValue({ id: 'patient-1' }) },
      patientConsultationPackage: { create: vi.fn().mockResolvedValue({ id: 'package-1', status: 'ACTIVE' }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const { service } = setup(tx);

    const result = await service.create(session, {
      patientId: 'patient-1', name: '  Consultas mensais  ', totalSessions: 4, amountCents: 50000,
    });

    expect(result).toEqual({ ok: true, package: { id: 'package-1', status: 'ACTIVE' } });
    expect(tx.patientConsultationPackage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: session.accountId, patientId: 'patient-1', name: 'Consultas mensais',
        totalSessions: 4, remainingSessions: 4, amountCents: 50000, status: 'ACTIVE',
        purchasedAt: fixedNow, createdAt: fixedNow,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PATIENT_PACKAGE_CREATED', resourceId: 'package-1' }),
    });
  });

  it('rejects invalid package values before opening a database transaction', async () => {
    const { service } = setup({});
    expect(await service.create(session, {
      patientId: 'patient-1', name: '  ', totalSessions: 2, amountCents: 100,
    })).toEqual({ ok: false, reason: 'validation' });
    expect(await service.create({ ...session, role: 'SECRETARIA' }, {
      patientId: 'patient-1', name: 'Pacote', totalSessions: 2, amountCents: 100,
    })).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('summarizes only active balances and associates usage history', async () => {
    const tx = {
      patient: { findFirst: vi.fn().mockResolvedValue({ id: 'patient-1' }) },
      patientConsultationPackage: { findMany: vi.fn().mockResolvedValue([
        { id: 'active', status: 'ACTIVE', remainingSessions: 2 },
        { id: 'completed', status: 'COMPLETED', remainingSessions: 0 },
      ]) },
      packageSession: { findMany: vi.fn().mockResolvedValue([
        { id: 'usage-1', packageId: 'active', appointmentId: 'appointment-1', usedAt: fixedNow },
      ]) },
    };
    const { service } = setup(tx);

    const result = await service.list(session, 'patient-1');
    expect(result).toMatchObject({
      ok: true,
      balance: { activePackages: 1, remainingSessions: 2 },
      items: [{ id: 'active', sessions: [{ id: 'usage-1' }] }, { id: 'completed', sessions: [] }],
    });
  });

  it('cancels only active packages and records the audit event', async () => {
    const tx = {
      patientConsultationPackage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const { service } = setup(tx);

    expect(await service.cancel(session, 'package-1')).toEqual({ ok: true });
    expect(tx.patientConsultationPackage.updateMany).toHaveBeenCalledWith({
      where: { id: 'package-1', status: 'ACTIVE' }, data: { status: 'CANCELED' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PATIENT_PACKAGE_CANCELED', resourceId: 'package-1' }),
    });
  });

  it('does not decrement a package a second time for the same appointment', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      packageSession: { findUnique: vi.fn().mockResolvedValue({ id: 'usage-1' }) },
      patientConsultationPackage: { updateMany: vi.fn() },
    };
    const result = await consumeAppointmentPackage(tx as any, {
      accountId: session.accountId, appointmentId: 'appointment-1', patientId: 'patient-1',
      actorUserId: session.userId, now: fixedNow,
    });
    expect(result).toEqual({ consumed: false, alreadyConsumed: true });
    expect(tx.patientConsultationPackage.updateMany).not.toHaveBeenCalled();
  });

  it('consumes one session atomically and completes the package at zero', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      packageSession: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'usage-1' }),
      },
      patientConsultationPackage: {
        findFirst: vi.fn().mockResolvedValue({ id: 'package-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ remainingSessions: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await consumeAppointmentPackage(tx as any, {
      accountId: session.accountId, appointmentId: 'appointment-1', patientId: 'patient-1',
      actorUserId: session.userId, now: fixedNow,
    });
    expect(result).toEqual({ consumed: true, alreadyConsumed: false, packageId: 'package-1' });
    expect(tx.patientConsultationPackage.updateMany).toHaveBeenCalledWith({
      where: { id: 'package-1', status: 'ACTIVE', remainingSessions: { gt: 0 } },
      data: { remainingSessions: { decrement: 1 } },
    });
    expect(tx.patientConsultationPackage.update).toHaveBeenCalledWith({
      where: { id: 'package-1' }, data: { status: 'COMPLETED' },
    });
    expect(tx.packageSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ packageId: 'package-1', appointmentId: 'appointment-1', usedAt: fixedNow }),
    });
  });

  it('leaves appointments without an available active package untouched', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      packageSession: { findUnique: vi.fn().mockResolvedValue(null) },
      patientConsultationPackage: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
    };
    const result = await consumeAppointmentPackage(tx as any, {
      accountId: session.accountId, appointmentId: 'appointment-1', patientId: 'patient-1',
      actorUserId: session.userId, now: fixedNow,
    });
    expect(result).toEqual({ consumed: false, alreadyConsumed: false });
    expect(tx.patientConsultationPackage.updateMany).not.toHaveBeenCalled();
  });
});
