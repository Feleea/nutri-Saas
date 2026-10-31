import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  encryptClinicalData, newTenantDataKey, unwrapTenantDataKey, wrapTenantDataKey,
} from '../src/clinical/encryption';

const BATCH_SIZE = 100;
const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
let stage = 'checking legacy counts';

type AnamnesisRow = { id: string; accountId: string; legacyAnswers: unknown };
type KeyStore = Pick<Prisma.TransactionClient, 'tenantDataEncryptionKey'>;

async function counts() {
  const [anamnesis, anthropometry, incompleteAnthropometry] = await Promise.all([
    owner.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "AnamnesisRecord"
      WHERE "answersCiphertext" IS NULL AND "legacyAnswers" IS NOT NULL`,
    owner.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "AnthropometryRecord"
      WHERE "clinicalDataCiphertext" IS NULL AND "weightKg" IS NOT NULL`,
    owner.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "AnthropometryRecord"
      WHERE "clinicalDataCiphertext" IS NULL AND (
        "measuredAt" IS NULL OR "weightKg" IS NULL OR "heightCm" IS NULL OR "bmi" IS NULL
      )`,
  ]);
  return {
    anamnesis: Number(anamnesis[0].count),
    anthropometry: Number(anthropometry[0].count),
    incompleteAnthropometry: Number(incompleteAnthropometry[0].count),
  };
}

async function dataKey(tx: KeyStore, accountId: string) {
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

async function backfillAnamnesis() {
  stage = 'backfilling anamnesis';
  let lastId = '';
  let processed = 0;
  while (true) {
    const rows = await owner.$queryRaw<AnamnesisRow[]>`
      SELECT "id", "accountId", "legacyAnswers"
      FROM "AnamnesisRecord"
      WHERE "answersCiphertext" IS NULL AND "legacyAnswers" IS NOT NULL AND "id" > ${lastId}
      ORDER BY "id" LIMIT ${BATCH_SIZE}`;
    if (!rows.length) return processed;
    for (const row of rows) {
      await owner.$transaction(async (tx) => {
        const current = await tx.anamnesisRecord.findUnique({ where: { id: row.id } });
        if (!current || current.answersCiphertext) return;
        if (current.legacyAnswers === null) throw new Error('anamnese legada inconsistente');
        const key = await dataKey(tx, current.accountId);
        let answersCiphertext: string;
        try {
          answersCiphertext = encryptClinicalData(
            current.accountId, current.id, 'ANAMNESIS_ANSWERS', current.legacyAnswers, key,
          );
        } finally {
          key.fill(0);
        }
        await tx.anamnesisRecord.update({
          where: { id: current.id },
          data: { answersCiphertext, legacyAnswers: Prisma.DbNull },
        });
      });
      processed++;
    }
    lastId = rows[rows.length - 1].id;
  }
}

async function backfillAnthropometry() {
  stage = 'backfilling anthropometry';
  let lastId = '';
  let processed = 0;
  while (true) {
    const rows = await owner.anthropometryRecord.findMany({
      where: { id: { gt: lastId }, clinicalDataCiphertext: null, weightKg: { not: null } },
      orderBy: { id: 'asc' }, take: BATCH_SIZE,
    });
    if (!rows.length) return processed;
    for (const row of rows) {
      await owner.$transaction(async (tx) => {
        const current = await tx.anthropometryRecord.findUnique({ where: { id: row.id } });
        if (!current || current.clinicalDataCiphertext) return;
        if (!current.measuredAt || !current.weightKg || !current.heightCm || !current.bmi) {
          throw new Error('medição legada inconsistente');
        }
        const key = await dataKey(tx, current.accountId);
        const clinicalData = {
          measuredAt: current.measuredAt.toISOString(),
          weightKg: Number(current.weightKg),
          heightCm: Number(current.heightCm),
          bmi: Number(current.bmi),
          waistCm: current.waistCm === null ? null : Number(current.waistCm),
          hipCm: current.hipCm === null ? null : Number(current.hipCm),
          neckCm: current.neckCm === null ? null : Number(current.neckCm),
          armCm: current.armCm === null ? null : Number(current.armCm),
          thighCm: current.thighCm === null ? null : Number(current.thighCm),
        };
        let clinicalDataCiphertext: string;
        try {
          clinicalDataCiphertext = encryptClinicalData(
            current.accountId, current.id, 'ANTHROPOMETRY', clinicalData, key,
          );
        } finally {
          key.fill(0);
        }
        await tx.anthropometryRecord.update({
          where: { id: current.id },
          data: {
            clinicalDataCiphertext, measuredAt: null, weightKg: null, heightCm: null, bmi: null,
            waistCm: null, hipCm: null, neckCm: null, armCm: null, thighCm: null,
          },
        });
      });
      processed++;
    }
    lastId = rows[rows.length - 1].id;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply' && arg !== '--dry-run');
  if (unknown.length || (apply && process.argv.includes('--dry-run'))) {
    throw new Error('uso: npm run clinical:backfill [--dry-run|--apply]');
  }
  const before = await counts();
  if (before.incompleteAnthropometry) {
    throw new Error('há medições legadas incompletas; nenhuma linha foi alterada');
  }
  if (!apply) {
    console.log(`Dry-run: ${before.anamnesis} anamneses e ${before.anthropometry} medições pendentes; nenhuma linha alterada.`);
    return;
  }
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error('APP_ENCRYPTION_KEY ausente');
  const anamnesis = await backfillAnamnesis();
  const anthropometry = await backfillAnthropometry();
  stage = 'verifying backfill';
  const after = await counts();
  if (after.anamnesis || after.anthropometry || after.incompleteAnthropometry) {
    throw new Error('backfill incompleto; dados legados foram preservados onde não processados');
  }
  console.log(`Backfill concluído: ${anamnesis} anamneses e ${anthropometry} medições cifradas; sem valores clínicos no log.`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code
    : error instanceof Error ? error.name : 'erro desconhecido';
  console.error(`Falha no backfill clínico durante ${stage} (${reason}); os valores legados não processados foram preservados.`);
  process.exitCode = 1;
}).finally(() => owner.$disconnect());
