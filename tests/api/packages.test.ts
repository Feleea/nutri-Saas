import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { POST as createPatient } from '@/app/api/patients/route';
import { POST as createAppointment } from '@/app/api/agenda/route';
import { POST as setAppointmentStatus } from '@/app/api/agenda/[id]/status/route';
import { POST as cancelAppointment } from '@/app/api/agenda/[id]/cancel/route';
import { POST as createPackage, GET as listPackages } from '@/app/api/packages/route';
import { POST as cancelPackage } from '@/app/api/packages/[id]/cancel/route';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniqueEmail = () => `pkg-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function setupTenant() {
  const email = uniqueEmail();
  await call(signup, {
    body: {
      accountName: 'Pacotes', userName: 'Pacotes', email, password: PASSWORD,
      acceptTerms: true, acceptPrivacy: true, acceptDpa: true,
    },
  });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const patient = (await call(createPatient, {
    cookie, body: { fullName: 'Paciente de pacote', email: uniqueEmail() },
  })).json.patient.id as string;
  return { cookie, patient };
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API · pacotes de consultas', () => {
  it('creates packages, consumes only on completion, preserves no-shows and canceled appointments, and cancels packages', async () => {
    const tenant = await setupTenant();
    const created = await call(createPackage, {
      cookie: tenant.cookie,
      body: { patientId: tenant.patient, name: 'Retorno mensal', totalSessions: 2, amountCents: 32000 },
    });
    expect(created.status).toBe(201);
    expect(created.json.package).toMatchObject({
      patientId: tenant.patient, name: 'Retorno mensal', totalSessions: 2, remainingSessions: 2, status: 'ACTIVE',
    });
    const packageId = created.json.package.id as string;

    let appointmentHour = 72;
    const makeAppointment = async () => {
      const result = await call(createAppointment, {
        cookie: tenant.cookie, body: { patientId: tenant.patient, startsAt: inHours(appointmentHour++) },
      });
      expect(result.status).toBe(201);
      return result.json.appointment.id as string;
    };
    const setStatus = (id: string, status: 'COMPLETED' | 'NO_SHOW') =>
      call(setAppointmentStatus, { cookie: tenant.cookie, params: { id }, body: { status } });

    const completedId = await makeAppointment();
    expect((await setStatus(completedId, 'COMPLETED')).status).toBe(200);
    expect((await setStatus(completedId, 'COMPLETED')).json.error.code).toBe('not_editable');

    const noShowId = await makeAppointment();
    expect((await setStatus(noShowId, 'NO_SHOW')).status).toBe(200);
    const canceledId = await makeAppointment();
    expect((await call(cancelAppointment, {
      cookie: tenant.cookie, params: { id: canceledId }, body: { reason: 'Paciente solicitou cancelamento' },
    })).status).toBe(200);

    const balance = await call(listPackages, {
      method: 'GET', cookie: tenant.cookie, url: `http://localhost/api/packages?patientId=${tenant.patient}`,
    });
    expect(balance.status).toBe(200);
    expect(balance.json.balance).toEqual({ activePackages: 1, remainingSessions: 1 });
    expect(balance.json.items[0].sessions).toHaveLength(1);
    expect(balance.json.items[0].sessions[0].appointmentId).toBe(completedId);

    expect((await call(cancelPackage, { cookie: tenant.cookie, params: { id: packageId } })).status).toBe(200);
    expect((await call(cancelPackage, { cookie: tenant.cookie, params: { id: packageId } })).status).toBe(409);
    const canceled = await call(listPackages, {
      method: 'GET', cookie: tenant.cookie, url: `http://localhost/api/packages?patientId=${tenant.patient}`,
    });
    expect(canceled.json.balance).toEqual({ activePackages: 0, remainingSessions: 0 });
    expect(canceled.json.items[0].status).toBe('CANCELED');
  });

  it('rejects packages that are not tied to an active patient in the current tenant', async () => {
    const tenant = await setupTenant();
    const response = await call(createPackage, {
      cookie: tenant.cookie,
      body: { patientId: 'patient-from-another-account', name: 'Pacote', totalSessions: 3, amountCents: 10000 },
    });
    expect([response.status, response.json.error.code]).toEqual([404, 'patient_not_found']);
  });
});
