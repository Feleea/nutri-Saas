import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { forTenant } from '../../src/db/tenant';
import { adminPrisma } from '../../src/db/admin';
import { createMealPlanService } from '../../src/meal-plans/service';
import type { SessionInfo } from '../../src/auth/service';
import { decryptClinicalData, unwrapTenantDataKey } from '../../src/clinical/encryption';
import { backfillMealPlanVersions } from '../../scripts/backfill-meal-plan-encryption';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const plans = createMealPlanService({ db: app });
const sessionA: SessionInfo = { userId: `${TENANT_A}_user`, accountId: TENANT_A, role: 'TITULAR' };
const sessionB: SessionInfo = { userId: `${TENANT_B}_user`, accountId: TENANT_B, role: 'PROFISSIONAL' };
let patientA: string;
let patientB: string;
let patientWithoutConsent: string;
let foodId: string;
let alternativeFoodId: string;
let measureId: string;
let createdPlanId: string;
let mealIdB: string;

const input = (baseVersion?: number, alternatives: { foodId: string; quantity: number }[] = []) => ({
  title: 'Plano para teste',
  ...(baseVersion === undefined ? {} : { baseVersion }),
  meals: [{
    name: 'Café da manhã',
    time: '08:00',
    items: [{ foodId, quantity: 2, measureId, alternatives }],
  }],
});

beforeAll(async () => {
  await seedTenants(owner);
  const [a, b, noConsent] = await Promise.all([
    owner.patient.create({ data: { accountId: TENANT_A, fullName: 'Paciente plano A' } }),
    owner.patient.create({ data: { accountId: TENANT_B, fullName: 'Paciente plano B' } }),
    owner.patient.create({ data: { accountId: TENANT_A, fullName: 'Paciente sem consentimento' } }),
  ]);
  patientA = a.id;
  patientB = b.id;
  patientWithoutConsent = noConsent.id;
  await owner.patientConsent.create({
    data: { accountId: TENANT_A, patientId: patientA, kind: 'DATA_PROCESSING', version: 'test-v1', recordedByUserId: sessionA.userId },
  });
  await owner.patientConsent.create({
    data: { accountId: TENANT_B, patientId: patientB, kind: 'DATA_PROCESSING', version: 'test-v1', recordedByUserId: sessionB.userId },
  });
  const table = await owner.foodTable.create({
    data: { code: 'PLAN_TEST', name: 'Tabela sintética de plano', version: 'v1', license: 'dados sintéticos de teste' },
  });
  const food = await owner.food.create({
    data: {
      tableId: table.id, externalCode: 'PLAN-1', name: 'Aveia sintética', normalizedName: 'aveia sintetica',
      energyKcal: 380, proteinG: null, carbG: 68, fatG: 7, fiberG: 10,
      micros: { calciumMg: 50, vitaminCMg: null },
    },
  });
  foodId = food.id;
  const alternativeFood = await owner.food.create({
    data: {
      tableId: table.id, externalCode: 'PLAN-2', name: 'Banana sintética', normalizedName: 'banana sintetica',
      energyKcal: 90, proteinG: 1, carbG: 23, fatG: 0.3, fiberG: 2.6,
    },
  });
  alternativeFoodId = alternativeFood.id;
  const measure = await owner.householdMeasure.create({ data: { foodId, label: 'colher de sopa', grams: 15 } });
  measureId = measure.id;
}, 30_000);

afterAll(async () => { await Promise.all([owner.$disconnect(), app.$disconnect(), adminPrisma.$disconnect()]); });

describe('US-PLA-01/02/03/07 · persistência e isolamento de planos [seg][api]', () => {
  it('exige consentimento vigente e papel clínico', async () => {
    expect(await plans.list(sessionA, patientWithoutConsent)).toMatchObject({ ok: false, reason: 'consent_required' });
    expect(await plans.create({ ...sessionA, role: 'SECRETARIA' }, patientA, input())).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('converte medida caseira, congela fonte/nutrientes, soma sem zerar ausentes e cria versões imutáveis', async () => {
    const created = await plans.create(sessionA, patientA, input(undefined, [{ foodId: alternativeFoodId, quantity: 30 }]));
    if (!created.ok) throw new Error(JSON.stringify(created));
    createdPlanId = created.plan.id;
    const storedPlan = await owner.mealPlan.findUniqueOrThrow({ where: { id: createdPlanId } });
    const storedVersion = await owner.mealPlanVersion.findFirstOrThrow({ where: { planId: createdPlanId } });
    expect(storedPlan.title).toBeNull();
    expect(storedVersion.title).toBeNull();
    expect(storedVersion.encryptedPayload).toBeTruthy();
    expect(storedVersion.encryptedPayload).not.toContain('Plano para teste');
    expect(storedVersion.encryptedPayload).not.toContain('Café da manhã');
    expect(storedVersion.encryptedPayload).not.toContain('Aveia sintética');
    expect(storedVersion.encryptedPayload).not.toContain('Banana sintética');
    expect(await owner.mealPlanMeal.count({ where: { accountId: TENANT_A } })).toBe(0);
    expect(await owner.mealPlanItem.count({ where: { accountId: TENANT_A } })).toBe(0);
    await expect(forTenant(TENANT_A, sessionA.userId, app).mealPlan.create({
      data: { accountId: TENANT_A, patientId: patientA, title: 'Plano plaintext bloqueado', createdByUserId: sessionA.userId },
    })).rejects.toThrow(/títulos de plano devem ser cifrados/i);
    const emptyPlan = await forTenant(TENANT_A, sessionA.userId, app).mealPlan.create({
      data: { accountId: TENANT_A, patientId: patientA, title: null, createdByUserId: sessionA.userId },
    });
    await expect(forTenant(TENANT_A, sessionA.userId, app).mealPlanVersion.create({
      data: { planId: emptyPlan.id, accountId: TENANT_A, version: 1, title: 'plaintext bloqueado', createdByUserId: sessionA.userId },
    })).rejects.toThrow(/payload de versão deve ser cifrado/i);
    const wrappedKey = await owner.tenantDataEncryptionKey.findUniqueOrThrow({ where: { accountId: TENANT_A } });
    const dataKey = unwrapTenantDataKey(TENANT_A, wrappedKey.wrappedKey);
    try {
      expect(decryptClinicalData(
        TENANT_A, `${createdPlanId}:v1:${storedVersion.id}`, 'PLAN_VERSION', storedVersion.encryptedPayload!, dataKey,
      )).toMatchObject({ title: 'Plano para teste', meals: [{ name: 'Café da manhã', time: '08:00' }] });
    } finally { dataKey.fill(0); }
    expect(created.version.meals[0].items[0]).toMatchObject({
      quantity: 2, grams: 30, measureLabel: 'colher de sopa',
      sourceCode: 'PLAN_TEST', sourceVersion: 'v1',
    });
    expect(created.version.meals[0].items[0].alternatives[0]).toMatchObject({
      foodId: alternativeFoodId, foodName: 'Banana sintética', grams: 30,
      comparison: { exceedsTolerance: true },
    });
    expect(created.version.meals[0].totals).toMatchObject({
      energyKcal: { value: 114, complete: true, missing: 0 },
      proteinG: { value: 0, complete: false, missing: 1 },
      calciumMg: { value: 15, complete: true, missing: 0 },
      vitaminCMg: { value: 0, complete: false, missing: 1 },
    });

    const updated = await plans.createVersion(sessionA, patientA, created.plan.id, {
      title: 'Plano revisado', baseVersion: 1, meals: input().meals,
    });
    expect(updated).toMatchObject({ ok: true, version: { version: 2 } });
    const stale = await plans.createVersion(sessionA, patientA, created.plan.id, {
      title: 'Versão concorrente', baseVersion: 1, meals: input().meals,
    });
    expect(stale).toMatchObject({ ok: false, reason: 'conflict' });

    const history = await plans.get(sessionA, patientA, created.plan.id);
    if (!history.ok) throw new Error(JSON.stringify(history));
    expect(history.plan.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(history.plan.versions.map((version) => version.title)).toEqual(['Plano revisado', 'Plano para teste']);
    expect(history.plan.versions[1].meals[0].items[0].quantity).toBe(2);
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { accountId: TENANT_A, resource: 'MealPlan', resourceId: created.plan.id, action: 'MEAL_PLAN_VERSION_CREATED' },
    });
    expect(audit.details).toBeNull();
    expect(JSON.stringify(audit)).not.toContain('Aveia');
    expect(JSON.stringify(audit)).not.toContain('Plano revisado');

    expect(await plans.get(sessionB, patientB, created.plan.id)).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await forTenant(TENANT_A, undefined, app).mealPlan.findUnique({ where: { id: created.plan.id } })).not.toBeNull();
    expect(await forTenant(TENANT_B, undefined, app).mealPlan.findUnique({ where: { id: created.plan.id } })).toBeNull();
    await expect(adminPrisma.$queryRawUnsafe('SELECT * FROM "MealPlan" LIMIT 1')).rejects.toThrow(/permission denied/i);
    await expect(forTenant(TENANT_A, undefined, app).mealPlanVersion.updateMany({ data: { version: 99 } })).rejects.toThrow(/permission denied/i);
    await expect(owner.mealPlanVersion.updateMany({ data: { version: 99 } })).rejects.toThrow(/imutável/i);
  });

  it('FK composta e trigger impedem vínculo com paciente ou alimento de outro tenant', async () => {
    await expect(owner.mealPlan.create({
      data: {
        accountId: TENANT_A, patientId: patientB, title: 'Não deve criar',
        createdByUserId: sessionA.userId,
      },
    })).rejects.toThrow();
    const planB = await plans.create(sessionB, patientB, {
      title: 'Plano tenant B',
      meals: [{ name: 'Almoço', time: '12:00', items: [{ foodId, quantity: 100 }] }],
    });
    if (!planB.ok) throw new Error(JSON.stringify(planB));
    mealIdB = planB.version.meals[0].id;
    const privateFood = await owner.food.create({
      data: { accountId: TENANT_A, name: 'Alimento próprio A', normalizedName: 'alimento proprio a', energyKcal: 100 },
    });
    await expect(forTenant(TENANT_B, undefined, app).mealPlanItem.create({
      data: {
        accountId: TENANT_B, mealId: mealIdB, foodId: privateFood.id, quantity: 1, grams: 1,
        measureLabel: 'g', measureGrams: 1, foodName: 'Alimento próprio A', nutrients: {},
      },
    })).rejects.toThrow(/plaintext de plano estão desabilitadas/i);
    await expect(forTenant(TENANT_B, undefined, app).mealPlanItem.create({
      data: {
        accountId: TENANT_B, mealId: createdPlanId, foodId, quantity: 1, grams: 1,
        measureLabel: 'g', measureGrams: 1, foodName: 'invalid', nutrients: {},
      },
    })).rejects.toThrow();
  });

  it('backfill retomável preserva e cifra conteúdo legado antes de apagar plaintext', async () => {
    const legacy = await owner.mealPlan.create({
      data: { accountId: TENANT_A, patientId: patientA, title: 'Plano plaintext legado', createdByUserId: sessionA.userId },
    });
    const legacyVersion = await owner.mealPlanVersion.create({
      data: {
        planId: legacy.id, accountId: TENANT_A, version: 1, title: 'Plano plaintext legado',
        createdByUserId: sessionA.userId,
      },
    });
    const legacyMeal = await owner.mealPlanMeal.create({
      data: { accountId: TENANT_A, versionId: legacyVersion.id, name: 'Refeição privada', time: '13:10', sortOrder: 0 },
    });
    await owner.mealPlanItem.create({
      data: {
        accountId: TENANT_A, mealId: legacyMeal.id, foodId, quantity: 75, grams: 75,
        measureLabel: 'g', measureGrams: 1, foodName: 'Alimento legado secreto',
        nutrients: { energyKcal: 125 },
      },
    });

    expect(await backfillMealPlanVersions(owner, 1)).toBe(1);
    const stored = await owner.mealPlanVersion.findUniqueOrThrow({ where: { id: legacyVersion.id } });
    expect(stored.title).toBeNull();
    expect(stored.encryptedPayload).toBeTruthy();
    expect(await owner.mealPlan.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ title: null });
    expect(await owner.mealPlanMeal.count({ where: { versionId: legacyVersion.id } })).toBe(0);
    expect(await owner.mealPlanItem.count({ where: { mealId: legacyMeal.id } })).toBe(0);
    const loaded = await plans.get(sessionA, patientA, legacy.id);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    expect(loaded.plan.versions[0]).toMatchObject({
      title: 'Plano plaintext legado',
      meals: [{ name: 'Refeição privada', items: [{ foodName: 'Alimento legado secreto', grams: 75 }] }],
    });
    expect(await backfillMealPlanVersions(owner, 1)).toBe(0);
  });

  it('excluir o paciente remove planos, versões, refeições e itens em cascata', async () => {
    await owner.patient.delete({ where: { id: patientA } });
    expect(await owner.mealPlan.findUnique({ where: { id: createdPlanId } })).toBeNull();
    expect(await owner.mealPlanVersion.count({ where: { planId: createdPlanId } })).toBe(0);
  });
});
