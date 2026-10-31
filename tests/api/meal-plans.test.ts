import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { POST as createPatient } from '@/app/api/patients/route';
import { GET as foodMeasures } from '@/app/api/foods/[id]/measures/options/route';
import { GET as listPlans, POST as createPlan } from '@/app/api/patients/[id]/meal-plans/route';
import { GET as getPlan, PUT as createVersion } from '@/app/api/patients/[id]/meal-plans/[planId]/route';
import { call, cookieOf, tokenFrom } from './helpers';
import { ctx } from '@/src/server/context';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const email = `meal-plan-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

beforeAll(async () => {
  await seedTenants(owner);
}, 30_000);
afterAll(async () => { await owner.$disconnect(); });

describe('API de planos alimentares [api]', () => {
  it('cria, consulta e versiona o plano com busca da tabela e consentimento ativo', async () => {
    await call(signup, { body: {
      accountName: 'Conta teste de plano', userName: 'Nutricionista', email, password: PASSWORD,
      acceptTerms: true, acceptPrivacy: true, acceptDpa: true,
    } });
    await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
    const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
    const patient = await call(createPatient, {
      cookie, body: { fullName: 'Paciente de plano', phone: '11999990000', consent: true },
    });
    const patientId = patient.json.patient.id as string;
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    const membership = await owner.membership.findFirstOrThrow({ where: { userId: user.id } });

    const table = await owner.foodTable.create({
      data: { code: 'PLAN_API', name: 'Tabela sintética API', version: 'v1', license: 'dados sintéticos' },
    });
    const food = await owner.food.create({
      data: {
        tableId: table.id, externalCode: 'P1', name: 'Pera sintética', normalizedName: 'pera sintetica',
        energyKcal: 50, proteinG: 1, carbG: 12, fatG: null, fiberG: 2,
        micros: { calciumMg: 10 },
      },
    });
    const measure = await owner.householdMeasure.create({ data: { foodId: food.id, label: 'unidade', grams: 120 } });
    const options = await call(foodMeasures, { method: 'GET', cookie, params: { id: food.id } });
    expect(options.json.measures).toEqual(expect.arrayContaining([
      { id: null, label: 'g', grams: 1 },
      { id: measure.id, label: 'unidade', grams: 120 },
    ]));

    const body = {
      title: 'Plano de exemplo',
      meals: [{ name: 'Lanche', time: '15:30', items: [{ foodId: food.id, quantity: 1, measureId: measure.id }] }],
    };
    const created = await call(createPlan, { cookie, params: { id: patientId }, body });
    expect(created.status).toBe(201);
    expect(created.json.version.meals[0].items[0]).toMatchObject({
      foodName: 'Pera sintética', quantity: 1, grams: 120,
      sourceCode: 'PLAN_API', sourceVersion: 'v1',
    });
    expect(created.json.version.totals).toMatchObject({
      energyKcal: { value: 60, complete: true, missing: 0 },
      fatG: { value: 0, complete: false, missing: 1 },
    });
    const planId = created.json.plan.id as string;

    expect((await call(listPlans, { method: 'GET', cookie, params: { id: patientId } })).json.items).toHaveLength(1);
    const detail = await call(getPlan, { method: 'GET', cookie, params: { id: patientId, planId } });
    expect(detail.json.plan.versions.map((v: { version: number }) => v.version)).toEqual([1]);
    const updated = await call(createVersion, {
      method: 'PUT', cookie, params: { id: patientId, planId },
      body: { ...body, title: 'Plano atualizado', baseVersion: 1 },
    });
    expect(updated.status).toBe(200);
    expect(updated.json.version.version).toBe(2);
    const clinicalSession = { userId: user.id, accountId: membership.accountId, role: 'TITULAR' };
    const exported = await ctx().lgpd.exportPatient(clinicalSession, patientId);
    if (!exported.ok) throw new Error(JSON.stringify(exported));
    const download = await ctx().lgpd.downloadExport(clinicalSession, exported.token);
    if (!download.ok) throw new Error(JSON.stringify(download));
    const exportPayload = JSON.parse(download.content) as { secoes: { planosAlimentares: { versions: { title: string; meals: { name: string }[] }[] }[] } };
    expect(exportPayload.secoes.planosAlimentares[0].versions.map((version) => version.title)).toEqual(['Plano de exemplo', 'Plano atualizado']);
    expect(exportPayload.secoes.planosAlimentares[0].versions[0].meals[0].name).toBe('Lanche');
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { actorUserId: user.id, action: 'MEAL_PLAN_CREATED', resourceId: planId },
    });
    expect(audit.details).toBeNull();
    expect(JSON.stringify(audit)).not.toContain('Pera sintética');

    const noConsent = await owner.patient.create({
      data: { accountId: membership.accountId, fullName: 'Paciente sem consentimento' },
    });
    const blocked = await call(listPlans, { method: 'GET', cookie, params: { id: noConsent.id } });
    expect([blocked.status, blocked.json.error.code]).toEqual([409, 'consent_required']);
  });
});
