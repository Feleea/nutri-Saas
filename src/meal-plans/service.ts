import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '../auth/service';
import { forTenant, withTenant } from '../db/tenant';
import type { PatientDataSource } from '../lgpd/service';
import type { MealPlanBody, MealPlanVersionBody } from './validation';
import { calculateNutrientTotals, compareSubstitution, type NutrientSnapshot } from './nutrition';
import { decryptClinicalData, encryptClinicalData, newTenantDataKey, unwrapTenantDataKey, wrapTenantDataKey } from '../clinical/encryption';

const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);
const FORBIDDEN = { ok: false as const, reason: 'forbidden' as const };
const NOT_FOUND = { ok: false as const, reason: 'not_found' as const };
const CONSENT_REQUIRED = { ok: false as const, reason: 'consent_required' as const };
type Tx = Prisma.TransactionClient;
type KeyStore = Pick<Tx, 'tenantDataEncryptionKey'>;
type Input = MealPlanBody;
type PlanVersionPayload = {
  title: string;
  meals: {
    name: string;
    time: string;
    sortOrder: number;
    items: {
      foodId: string;
      quantity: number;
      grams: number;
      measureId: string | null;
      measureLabel: string;
      measureGrams: number;
      foodName: string;
      sourceCode: string | null;
      sourceName: string | null;
      sourceVersion: string | null;
      nutrients: NutrientSnapshot;
      alternatives: {
        foodId: string;
        quantity: number;
        grams: number;
        measureLabel: string;
        foodName: string;
        sourceCode: string | null;
        sourceName: string | null;
        sourceVersion: string | null;
        nutrients: NutrientSnapshot;
      }[];
    }[];
  }[];
};
type LegacyVersionRow = {
  id: string;
  planId: string;
  accountId: string;
  version: number;
  title: string | null;
  encryptedPayload: string | null;
  createdAt: Date;
  plan: { title: string | null };
  meals: {
    name: string;
    time: string;
    sortOrder: number;
    items: {
      foodId: string;
      quantity: Prisma.Decimal;
      grams: Prisma.Decimal;
      measureId: string | null;
      measureLabel: string;
      measureGrams: Prisma.Decimal;
      foodName: string;
      sourceCode: string | null;
      sourceName: string | null;
      sourceVersion: string | null;
      nutrients: Prisma.JsonValue;
    }[];
  }[];
};
class InvalidMealPlanInput extends Error {
  constructor(readonly errors: string[]) { super('invalid meal plan input'); }
}

async function ensureTenantDataKey(tx: KeyStore, accountId: string): Promise<Buffer> {
  const generated = newTenantDataKey();
  try {
    const wrappedKey = wrapTenantDataKey(accountId, generated);
    const row = await tx.tenantDataEncryptionKey.upsert({
      where: { accountId },
      create: { accountId, wrappedKey },
      update: {},
    });
    return unwrapTenantDataKey(accountId, row.wrappedKey);
  } finally {
    generated.fill(0);
  }
}

async function existingTenantDataKey(tx: KeyStore, accountId: string): Promise<Buffer> {
  const row = await tx.tenantDataEncryptionKey.findUnique({ where: { accountId } });
  if (!row) throw new Error('chave clínica do tenant ausente');
  return unwrapTenantDataKey(accountId, row.wrappedKey);
}

function versionContext(planId: string, version: number, versionId: string) {
  return `${planId}:v${version}:${versionId}`;
}

function payloadFromLegacy(version: {
  title: string | null;
  plan: { title: string | null };
  meals: {
    name: string;
    time: string;
    sortOrder: number;
    items: {
      foodId: string;
      quantity: Prisma.Decimal;
      grams: Prisma.Decimal;
      measureId: string | null;
      measureLabel: string;
      measureGrams: Prisma.Decimal;
      foodName: string;
      sourceCode: string | null;
      sourceName: string | null;
      sourceVersion: string | null;
      nutrients: Prisma.JsonValue;
    }[];
  }[];
}): PlanVersionPayload {
  return {
    title: version.title ?? version.plan.title ?? '',
    meals: version.meals.map((meal) => ({
      name: meal.name,
      time: meal.time,
      sortOrder: meal.sortOrder,
      items: meal.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        grams: Number(item.grams),
        measureGrams: Number(item.measureGrams),
        nutrients: item.nutrients as NutrientSnapshot,
        alternatives: [],
      })),
    })),
  };
}

async function readVersionPayload(tx: Tx, version: LegacyVersionRow): Promise<PlanVersionPayload> {
  if (version.encryptedPayload) {
    const key = await existingTenantDataKey(tx, version.accountId);
    try {
      return decryptClinicalData(
        version.accountId,
        versionContext(version.planId, version.version, version.id),
        'PLAN_VERSION',
        version.encryptedPayload,
        key,
      ) as PlanVersionPayload;
    } finally {
      key.fill(0);
    }
  }
  return payloadFromLegacy(version);
}

async function dtoVersion(tx: Tx, version: LegacyVersionRow) {
  const payload = await readVersionPayload(tx, version);
  const meals = payload.meals.map((meal, mealIndex) => {
    const items = meal.items.map((item, itemIndex) => {
      const alternatives = item.alternatives ?? [];
      return {
        ...item,
        id: `${version.id}:meal:${mealIndex}:item:${itemIndex}`,
        alternatives: alternatives.map((alternative, alternativeIndex) => ({
          ...alternative,
          id: `${version.id}:meal:${mealIndex}:item:${itemIndex}:alternative:${alternativeIndex}`,
          comparison: compareSubstitution(item, alternative),
        })),
      };
    });
    return {
      id: `${version.id}:meal:${mealIndex}`,
      name: meal.name,
      time: meal.time,
      sortOrder: meal.sortOrder,
      items,
      totals: calculateNutrientTotals(items),
    };
  });
  return {
    id: version.id,
    version: version.version,
    title: payload.title,
    createdAt: version.createdAt,
    meals,
    totals: calculateNutrientTotals(meals.flatMap((meal) => meal.items)),
  };
}

async function patientAccess(tx: Tx, patientId: string) {
  const patient = await tx.patient.findFirst({
    where: { id: patientId },
    select: {
      id: true,
      status: true,
      consents: { where: { kind: 'DATA_PROCESSING', revokedAt: null }, select: { id: true }, take: 1 },
    },
  });
  if (!patient) return NOT_FOUND;
  if (!patient.consents.length) return CONSENT_REQUIRED;
  return { ok: true as const, patient };
}

function snapshotNutrients(food: {
  energyKcal: Prisma.Decimal | null;
  proteinG: Prisma.Decimal | null;
  carbG: Prisma.Decimal | null;
  fatG: Prisma.Decimal | null;
  fiberG: Prisma.Decimal | null;
  micros: Prisma.JsonValue | null;
}): NutrientSnapshot {
  const nutrients: NutrientSnapshot = {
    energyKcal: food.energyKcal === null ? null : Number(food.energyKcal),
    proteinG: food.proteinG === null ? null : Number(food.proteinG),
    carbG: food.carbG === null ? null : Number(food.carbG),
    fatG: food.fatG === null ? null : Number(food.fatG),
    fiberG: food.fiberG === null ? null : Number(food.fiberG),
  };
  if (food.micros && typeof food.micros === 'object' && !Array.isArray(food.micros)) {
    for (const [key, value] of Object.entries(food.micros)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(key)) {
        nutrients[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
      }
    }
  }
  return nutrients;
}

export function createMealPlanService({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  async function insertVersion(
    tx: Tx,
    s: SessionInfo,
    planId: string,
    version: number,
    input: Input,
  ) {
    const foodIds = [...new Set(input.meals.flatMap((meal) => meal.items.flatMap((item) => [
      item.foodId, ...(item.alternatives ?? []).map((alternative) => alternative.foodId),
    ])))];
    const foods = await tx.food.findMany({
      where: { id: { in: foodIds }, OR: [{ accountId: null }, { accountId: s.accountId }] },
      include: { table: { select: { code: true, name: true, version: true } } },
    });
    const foodById = new Map(foods.map((food) => [food.id, food]));
    if (foodById.size !== foodIds.length) throw new InvalidMealPlanInput(['food_unavailable']);

    const measureIds = [...new Set(input.meals.flatMap((meal) => meal.items.flatMap((item) => item.measureId ? [item.measureId] : [])))];
    const measures = measureIds.length ? await tx.householdMeasure.findMany({ where: { id: { in: measureIds } } }) : [];
    const measureById = new Map(measures.map((measure) => [measure.id, measure]));
    for (const meal of input.meals) {
      for (const item of meal.items) {
        const measure = item.measureId ? measureById.get(item.measureId) : undefined;
        if (item.measureId && (!measure || measure.foodId !== item.foodId)) {
          throw new InvalidMealPlanInput(['measure_unavailable']);
        }
        const grams = Number((item.quantity * (measure ? Number(measure.grams) : 1)).toFixed(3));
        if (!Number.isFinite(grams) || grams <= 0 || grams > 1000000) {
          throw new InvalidMealPlanInput(['quantity_out_of_range']);
        }
        for (const alternative of item.alternatives ?? []) {
          const alternativeGrams = Number(alternative.quantity.toFixed(3));
          if (!Number.isFinite(alternativeGrams) || alternativeGrams <= 0 || alternativeGrams > 1000000) {
            throw new InvalidMealPlanInput(['quantity_out_of_range']);
          }
        }
      }
    }

    const versionId = randomUUID();
    const payload: PlanVersionPayload = {
      title: input.title,
      meals: input.meals.map((meal, sortOrder) => ({
        name: meal.name,
        time: meal.time,
        sortOrder,
        items: meal.items.map((item) => {
          const food = foodById.get(item.foodId)!;
          const measure = item.measureId ? measureById.get(item.measureId) : undefined;
          const measureGrams = measure ? Number(measure.grams) : 1;
          const nutrients = snapshotNutrients(food);
          const alternatives = (item.alternatives ?? []).map((alternative) => {
            const alternativeFood = foodById.get(alternative.foodId)!;
            return {
              foodId: alternativeFood.id,
              quantity: alternative.quantity,
              grams: Number(alternative.quantity.toFixed(3)),
              measureLabel: 'g',
              foodName: alternativeFood.name,
              sourceCode: alternativeFood.table?.code ?? null,
              sourceName: alternativeFood.table?.name ?? (alternativeFood.accountId ? 'Alimento próprio' : null),
              sourceVersion: alternativeFood.table?.version ?? null,
              nutrients: snapshotNutrients(alternativeFood),
            };
          });
          return {
            foodId: food.id,
            quantity: item.quantity,
            grams: Number((item.quantity * measureGrams).toFixed(3)),
            measureId: measure?.id ?? null,
            measureLabel: measure?.label ?? 'g',
            measureGrams,
            foodName: food.name,
            sourceCode: food.table?.code ?? null,
            sourceName: food.table?.name ?? (food.accountId ? 'Alimento próprio' : null),
            sourceVersion: food.table?.version ?? null,
            nutrients,
            alternatives,
          };
        }),
      })),
    };
    const key = await ensureTenantDataKey(tx, s.accountId);
    let encryptedPayload: string;
    try {
      encryptedPayload = encryptClinicalData(
        s.accountId, versionContext(planId, version, versionId), 'PLAN_VERSION', payload, key,
      );
    } finally {
      key.fill(0);
    }
    return tx.mealPlanVersion.create({
      data: {
        id: versionId, planId, accountId: s.accountId, version, title: null,
        encryptedPayload, createdByUserId: s.userId, createdAt: now(),
      },
    });
  }

  async function list(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientAccess(tx, patientId);
      if (!access.ok) return access;
      const plans = await tx.mealPlan.findMany({
        where: { patientId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50,
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            include: {
              plan: { select: { title: true } },
              meals: { orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { id: 'asc' } } } },
            },
          },
        },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'MEAL_PLANS_LISTED',
        resource: 'Patient', resourceId: patientId, createdAt: now(),
      } });
      return {
        ok: true as const,
        items: await Promise.all(plans.map(async (plan) => ({
          id: plan.id,
          title: plan.versions[0] ? (await readVersionPayload(tx, plan.versions[0])).title : plan.title ?? '',
          createdAt: plan.createdAt,
          latest: plan.versions[0] ? await dtoVersion(tx, plan.versions[0]) : null,
        }))),
      };
    }, db);
  }

  async function get(s: SessionInfo, patientId: string, planId: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientAccess(tx, patientId);
      if (!access.ok) return access;
      const plan = await tx.mealPlan.findFirst({
        where: { id: planId, patientId },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            include: {
              plan: { select: { title: true } },
              meals: { orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { id: 'asc' } } } },
            },
          },
        },
      });
      if (!plan) return NOT_FOUND;
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'MEAL_PLAN_READ',
        resource: 'MealPlan', resourceId: plan.id, createdAt: now(),
      } });
      const versions = await Promise.all(plan.versions.map((version) => dtoVersion(tx, version)));
      return {
        ok: true as const,
        plan: {
          id: plan.id, title: versions[0]?.title ?? plan.title ?? '', createdAt: plan.createdAt,
          versions,
        },
      };
    }, db);
  }

  async function create(s: SessionInfo, patientId: string, input: Input) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    try {
      return await withTenant(s.accountId, async (tx) => {
        const access = await patientAccess(tx, patientId);
        if (!access.ok) return access;
        if (access.patient.status !== 'ACTIVE') return { ok: false as const, reason: 'patient_archived' };
        const plan = await tx.mealPlan.create({
          data: {
            accountId: s.accountId, patientId, title: null,
            createdByUserId: s.userId, createdAt: now(),
          },
        });
        await insertVersion(tx, s, plan.id, 1, input);
        await tx.auditLog.create({ data: {
          accountId: s.accountId, actorUserId: s.userId, action: 'MEAL_PLAN_CREATED',
          resource: 'MealPlan', resourceId: plan.id, createdAt: now(),
        } });
        const result = await tx.mealPlan.findFirst({
          where: { id: plan.id },
          include: { versions: { include: { plan: { select: { title: true } }, meals: { orderBy: { sortOrder: 'asc' }, include: { items: true } } } } },
        });
        const version = await dtoVersion(tx, result!.versions[0]);
        return {
          ok: true as const,
          plan: { id: result!.id, title: version.title, createdAt: result!.createdAt },
          version,
        };
      }, db);
    } catch (error) {
      if (error instanceof InvalidMealPlanInput) return { ok: false as const, reason: 'validation', errors: error.errors };
      throw error;
    }
  }

  async function createVersion(s: SessionInfo, patientId: string, planId: string, input: MealPlanVersionBody) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    try {
      return await withTenant(s.accountId, async (tx) => {
        const access = await patientAccess(tx, patientId);
        if (!access.ok) return access;
        if (access.patient.status !== 'ACTIVE') return { ok: false as const, reason: 'patient_archived' };
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meal-plan-${s.accountId}-${planId}`}))`;
        const plan = await tx.mealPlan.findFirst({ where: { id: planId, patientId } });
        if (!plan) return NOT_FOUND;
        const latest = await tx.mealPlanVersion.findFirst({
          where: { planId }, orderBy: { version: 'desc' }, select: { version: true },
        });
        if (!latest || latest.version !== input.baseVersion) return { ok: false as const, reason: 'conflict' };
        const added = await insertVersion(tx, s, planId, latest.version + 1, input);
        await tx.auditLog.create({ data: {
          accountId: s.accountId, actorUserId: s.userId, action: 'MEAL_PLAN_VERSION_CREATED',
          resource: 'MealPlan', resourceId: plan.id, createdAt: now(),
        } });
        const result = await tx.mealPlanVersion.findFirstOrThrow({
          where: { id: added.id },
          include: {
            plan: { select: { title: true } },
            meals: { orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { id: 'asc' } } } },
          },
        });
        return { ok: true as const, version: await dtoVersion(tx, result) };
      }, db);
    } catch (error) {
      if (error instanceof InvalidMealPlanInput) return { ok: false as const, reason: 'validation', errors: error.errors };
      throw error;
    }
  }

  return { list, get, create, createVersion };
}

type Tenant = ReturnType<typeof forTenant>;

export const mealPlanDataSource: PatientDataSource = {
  name: 'planosAlimentares',
  collect: async (tenant: Tenant, patientId: string) => {
    const plans = await tenant.mealPlan.findMany({
      where: { patientId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        versions: {
          orderBy: { version: 'asc' },
          include: {
            plan: { select: { title: true } },
            meals: { orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { id: 'asc' } } } },
          },
        },
      },
    });
    const keyByAccount = new Map<string, Buffer>();
    try {
      return await Promise.all(plans.map(async (plan) => {
        const versions = await Promise.all(plan.versions.map(async (version) => {
          const legacy = payloadFromLegacy(version);
          if (!version.encryptedPayload) return { id: version.id, version: version.version, createdAt: version.createdAt, ...legacy };
          let key = keyByAccount.get(version.accountId);
          if (!key) {
            const row = await tenant.tenantDataEncryptionKey.findUnique({ where: { accountId: version.accountId } });
            if (!row) throw new Error('chave clínica do tenant ausente');
            key = unwrapTenantDataKey(version.accountId, row.wrappedKey);
            keyByAccount.set(version.accountId, key);
          }
          const payload = decryptClinicalData<PlanVersionPayload>(
            version.accountId,
            versionContext(version.planId, version.version, version.id),
            'PLAN_VERSION',
            version.encryptedPayload,
            key,
          );
          return { id: version.id, version: version.version, createdAt: version.createdAt, ...payload };
        }));
        return {
          id: plan.id,
          createdAt: plan.createdAt,
          title: versions.at(-1)?.title ?? plan.title,
          versions,
        };
      }));
    } finally {
      for (const key of keyByAccount.values()) key.fill(0);
    }
  },
};
