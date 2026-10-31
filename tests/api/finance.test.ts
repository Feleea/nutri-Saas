import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { GET as me } from '@/app/api/me/route';
import { POST as createPatient } from '@/app/api/patients/route';
import { POST as createAppointment } from '@/app/api/agenda/route';
import { GET as finance } from '@/app/api/finance/route';
import { POST as createCharge } from '@/app/api/finance/charges/route';
import { POST as receiveCharge } from '@/app/api/finance/charges/[id]/receive/route';
import { GET as brand, POST as updateBrand } from '@/app/api/brand/route';
import { forTenant } from '@/src/db/tenant';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const email = `finance-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API · financeiro e identidade visual', () => {
  it('registra cobranças vinculadas ao paciente/consulta, resume o mês e protege as rotas clínicas', async () => {
    await call(signup, { body: {
      accountName: 'Clínica teste financeiro', userName: 'Nutricionista', email, password: PASSWORD,
      acceptTerms: true, acceptPrivacy: true, acceptDpa: true,
    } });
    await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
    const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
    const { userId } = (await call(me, { method: 'GET', cookie })).json;
    const patientId = (await call(createPatient, {
      cookie, body: { fullName: 'Paciente financeiro', phone: '11999990000', consent: true },
    })).json.patient.id as string;
    const date = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    const appointment = await call(createAppointment, {
      cookie, body: { patientId, date, time: '10:00' },
    });
    expect(appointment.status).toBe(201);

    const month = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    const pending = await call(createCharge, { cookie, body: {
      patientId, appointmentId: appointment.json.appointment.id, description: 'Consulta', amountCents: 7500,
      paymentMethod: 'PIX', status: 'PENDING', occurredAt: today,
    } });
    expect(pending.status).toBe(201);
    const received = await call(createCharge, { cookie, body: {
      patientId, description: 'Retorno', amountCents: 5000, paymentMethod: 'CREDIT_CARD',
      status: 'PAID', occurredAt: today, paidAt: today,
    } });
    expect(received.status).toBe(201);
    expect(received.json.charge.paidAt).toBeTruthy();

    const summary = await call(finance, { method: 'GET', cookie, url: `http://localhost/api/finance?month=${month}` });
    expect(summary.json.summary).toEqual({ receivedCents: 5000, pendingCents: 7500 });
    expect(summary.json.charges).toHaveLength(2);
    expect(await forTenant('tenant_b').charge.findMany()).toHaveLength(0);
    const markedReceived = await call(receiveCharge, {
      cookie, params: { id: pending.json.charge.id }, body: { paidAt: today },
    });
    expect(markedReceived.status).toBe(200);
    expect((await call(receiveCharge, {
      cookie, params: { id: pending.json.charge.id }, body: { paidAt: today },
    })).status).toBe(409);
    const updatedSummary = await call(finance, { method: 'GET', cookie, url: `http://localhost/api/finance?month=${month}` });
    expect(updatedSummary.json.summary).toEqual({ receivedCents: 12500, pendingCents: 0 });
    const otherPatientId = (await call(createPatient, {
      cookie, body: { fullName: 'Outro paciente', phone: '11999990001' },
    })).json.patient.id as string;
    const mismatch = await call(createCharge, { cookie, body: {
      patientId: otherPatientId, appointmentId: appointment.json.appointment.id,
      description: 'Inválida', amountCents: 1000, paymentMethod: 'PIX', status: 'PENDING',
    } });
    expect(mismatch.status).toBe(404);

    const savedLogo = await call(updateBrand, { cookie, body: { logoUrl: 'https://clinic.example.test/logo.png' } });
    expect(savedLogo.json.logoUrl).toBe('https://clinic.example.test/logo.png');
    expect((await call(brand, { method: 'GET', cookie })).json.logoUrl).toBe(savedLogo.json.logoUrl);

    await owner.membership.updateMany({ where: { userId }, data: { role: 'SECRETARIA' } });
    expect((await call(finance, { method: 'GET', cookie })).status).toBe(403);
    expect((await call(brand, { method: 'GET', cookie })).status).toBe(403);
  });
});
