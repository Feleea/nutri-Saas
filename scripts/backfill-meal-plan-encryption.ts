import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import {
  encryptClinicalData, newTenantDataKey, unwrapTenantDataKey, wrapTenantDataKey,
} from '../src/clinical/encryption';

const BATCH_SIZE = 25;
const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
let stage = 'checking legacy meal plans';

type PlanPayload = {
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
      nutrients: Prisma.JsonValue;
    }[];
  }[];
};

function context(planId: string, version: number, versionId: string) {
  return `${planId}:v${version}:${versionId}`;
}

async function counts(db: PrismaClient) {
  const [versions, plans, children] = await Promise.all([
    db.mealPlanVersion.count({ where: { encryptedPayload: null } }),
    db.mealPlan.count({ where: { title: { not: null } } }),
    db.mealPlanMeal.count(),
  ]);
  return { versions, plans, children };
}

async function dataKey(tx: Prisma.TransactionClient, accountId: string) {
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

export async function backfillMealPlanVersions(db: PrismaClient, batchSize = BATCH_SIZE) {
  stage = 'backfilling meal plan versions';
  let lastId = '';
  let processed = 0;
  while (true) {
    const plans = await db.mealPlan.findMany({
      where: {
        id: { gt: lastId },
        OR: [
          { title: { not: null } },
          { versions: { some: { encryptedPayload: null } } },
        ],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    });
    if (!plans.length) return processed;
    for (const { id } of plans) {
      await db.$transaction(async (tx) => {
        const plan = await tx.mealPlan.findUnique({
          where: { id },
          include: {
            versions: {
              orderBy: { version: 'asc' },
              include: { meals: { orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { id: 'asc' } } } } },
            },
          },
        });
        if (!plan) return;
        if (!plan.versions.length) throw new Error('plano legado sem versão; nada foi alterado');
        for (const version of plan.versions) {
          if (!version.encryptedPayload) {
            const payload: PlanPayload = {
              title: version.title ?? plan.title ?? '',
              meals: version.meals.map((meal) => ({
                name: meal.name,
                time: meal.time,
                sortOrder: meal.sortOrder,
                items: meal.items.map((item) => ({
                  foodId: item.foodId,
                  quantity: Number(item.quantity),
                  grams: Number(item.grams),
                  measureId: item.measureId,
                  measureLabel: item.measureLabel,
                  measureGrams: Number(item.measureGrams),
                  foodName: item.foodName,
                  sourceCode: item.sourceCode,
                  sourceName: item.sourceName,
                  sourceVersion: item.sourceVersion,
                  nutrients: item.nutrients,
                })),
              })),
            };
            const key = await dataKey(tx, version.accountId);
            let encryptedPayload: string;
            try {
              encryptedPayload = encryptClinicalData(
                version.accountId,
                context(version.planId, version.version, version.id),
                'PLAN_VERSION',
                payload,
                key,
              );
            } finally {
              key.fill(0);
            }
            await tx.mealPlanVersion.update({
              where: { id: version.id },
              data: { encryptedPayload, title: null },
            });
            processed++;
          }
          await tx.mealPlanMeal.deleteMany({ where: { accountId: version.accountId, versionId: version.id } });
        }
        if (plan.title !== null) await tx.mealPlan.update({ where: { id: plan.id }, data: { title: null } });
      });
    }
    lastId = plans[plans.length - 1].id;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply' && arg !== '--dry-run');
  if (unknown.length || (apply && process.argv.includes('--dry-run'))) {
    throw new Error('usage: npm run meal-plans:backfill [--dry-run|--apply]');
  }
  const before = await counts(owner);
  if (!apply) {
    console.log(`Dry-run: ${before.versions} versions need encryption, ${before.plans} plan titles and ${before.children} plaintext meal rows remain.`);
    return;
  }
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error('APP_ENCRYPTION_KEY ausente');
  const processed = await backfillMealPlanVersions(owner);
  stage = 'verifying backfill';
  const after = await counts(owner);
  if (after.versions || after.plans || after.children) {
    throw new Error('backfill incompleto; conteúdo legado não processado foi preservado');
  }
  console.log(`Backfill concluído: ${processed} versões cifradas; nenhum conteúdo clínico foi escrito no log.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const reason = error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : error instanceof Error ? error.name : 'erro desconhecido';
    console.error(`Falha no backfill de planos durante ${stage} (${reason}); os dados legados não processados foram preservados.`);
    process.exitCode = 1;
  }).finally(() => owner.$disconnect());
}
