import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { POST as createPatient } from '@/app/api/patients/route';
import { POST as createPlan } from '@/app/api/patients/[id]/meal-plans/route';
import { POST as invite } from '@/app/api/portal/invitations/route';
import { POST as revoke } from '@/app/api/portal/invitations/[id]/revoke/route';
import { POST as redeem } from '@/app/api/portal/redeem/route';
import { GET as portalSession } from '@/app/api/portal/session/route';
import { POST as logout } from '@/app/api/portal/logout/route';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniq = () => `portal-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const portalCookieName = 'sn_patient_portal';

async function setup() {
  const email = uniq();
  await call(signup, { body: {
    accountName: 'Conta portal',
    userName: 'Nutricionista portal',
    email,
    password: PASSWORD,
    acceptTerms: true,
    acceptPrivacy: true,
    acceptDpa: true,
  } });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const patient = await call(createPatient, {
    cookie,
    body: { fullName: 'Paciente portal', email: uniq(), phone: '11999990000', goal: 'Não expor no portal', consent: true },
  });
  const patientId = patient.json.patient.id as string;
  const clinician = await owner.user.findUniqueOrThrow({ where: { email } });
  const table = await owner.foodTable.create({
    data: { code: `PORTAL_${Date.now()}`, name: 'Tabela de teste portal', version: 'v1', license: 'dados sintéticos' },
  });
  const food = await owner.food.create({
    data: {
      tableId: table.id,
      externalCode: `P_${Date.now()}`,
      name: 'Alimento aprovado',
      normalizedName: 'alimento aprovado',
      energyKcal: 100,
      proteinG: 4,
      carbG: 10,
      fatG: 2,
      fiberG: 1,
    },
  });
  const plan = await call(createPlan, {
    cookie,
    params: { id: patientId },
    body: { title: 'Plano compartilhado', meals: [{ name: 'Café', time: '08:00', items: [{ foodId: food.id, quantity: 1 }] }] },
  });
  expect(plan.status).toBe(201);
  const unapprovedPlan = await call(createPlan, {
    cookie,
    params: { id: patientId },
    body: { title: 'Plano não aprovado', meals: [{ name: 'Jantar', time: '19:00', items: [{ foodId: food.id, quantity: 1 }] }] },
  });
  expect(unapprovedPlan.status).toBe(201);
  const membership = await owner.membership.findFirstOrThrow({ where: { userId: clinician.id } });
  const startsAt = new Date(Date.now() + 24 * 60 * 60_000);
  await owner.appointment.create({
    data: {
      accountId: membership.accountId,
      patientId,
      professionalUserId: clinician.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      online: true,
      meetingUrl: 'https://meet.example.test/appointment',
      createdByUserId: clinician.id,
    },
  });
  return {
    cookie,
    patientId,
    patientEmail: patient.json.patient.email,
    planId: plan.json.plan.id as string,
    unapprovedPlanId: unapprovedPlan.json.plan.id as string,
  };
}

beforeAll(async () => { await seedTenants(owner); }, 30_000);
afterAll(async () => { await owner.$disconnect(); });

describe('API do portal do paciente', () => {
  it('limita o convite ao e-mail cadastrado, resgata token uma vez e só expõe consultas futuras e planos aprovados', async () => {
    const t = await setup();
    const created = await call(invite, {
      cookie: t.cookie,
      body: { patientId: t.patientId, approvedPlanIds: [t.planId] },
    });
    expect(created.status).toBe(201);
    const email = tokenFrom(t.patientEmail, 'portal_invite');
    expect(email).toBeTruthy();

    const redeemed = await call(redeem, { body: { token: email } });
    expect(redeemed.status).toBe(200);
    const portalCookie = cookieOf(redeemed, portalCookieName);
    expect(portalCookie).toBeTruthy();
    const setCookie = redeemed.setCookies.find((value) => value.startsWith(`${portalCookieName}=`))!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api/portal');
    expect(setCookie).not.toContain('Domain=');

    const replay = await call(redeem, { body: { token: email } });
    expect([replay.status, replay.json.error.code]).toEqual([400, 'invalid_portal_access']);

    const content = await call(portalSession, { method: 'GET', cookie: portalCookie });
    expect(content.status).toBe(200);
    expect(content.json.appointments).toHaveLength(1);
    expect(content.json.appointments[0]).toMatchObject({
      online: true,
      meetingUrl: 'https://meet.example.test/appointment',
      professional: { name: 'Nutricionista portal' },
    });
    expect(content.json.mealPlans.map((plan: { id: string }) => plan.id)).toEqual([t.planId]);
    expect(content.json.mealPlans.map((plan: { id: string }) => plan.id)).not.toContain(t.unapprovedPlanId);
    expect(content.text).toContain('Alimento aprovado');
    expect(content.text).not.toContain('Não expor no portal');
    expect(content.text).not.toMatch(/anamnes|antropometr|charge|finance|goal|cpf|phone/i);

    await owner.patientConsent.updateMany({
      where: { patientId: t.patientId, kind: 'DATA_PROCESSING', revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect((await call(portalSession, { method: 'GET', cookie: portalCookie })).status).toBe(401);
    expect((await call(logout, { cookie: portalCookie })).status).toBe(200);
    expect((await call(portalSession, { method: 'GET', cookie: portalCookie })).status).toBe(401);
  });

  it('revoga convites e sessões e não distingue tokens inválidos de pacientes inexistentes', async () => {
    const t = await setup();
    const absent = await call(invite, {
      cookie: t.cookie,
      body: { patientId: 'patient-does-not-exist', approvedPlanIds: [] },
    });
    expect(absent.status).toBe(404);
    expect(absent.text).not.toContain(t.patientEmail);

    const invitation = await call(invite, {
      cookie: t.cookie,
      body: { patientId: t.patientId, approvedPlanIds: [] },
    });
    const token = tokenFrom(t.patientEmail, 'portal_invite');
    const session = await call(redeem, { body: { token } });
    const portalCookie = cookieOf(session, portalCookieName);
    const revoked = await call(revoke, {
      cookie: t.cookie,
      params: { id: invitation.json.invitationId },
    });
    expect(revoked.status).toBe(200);
    expect((await call(portalSession, { method: 'GET', cookie: portalCookie })).status).toBe(401);
    const invalid = await call(redeem, { body: { token: 'not-a-valid-token' } });
    expect([invalid.status, invalid.json.error.code]).toEqual([400, 'invalid_portal_access']);
  });
});
