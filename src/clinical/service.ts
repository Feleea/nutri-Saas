import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { SessionInfo } from '../auth/service';
import { withTenant } from '../db/tenant';
import type { PatientDataSource } from '../lgpd/service';
import {
  decryptClinicalData, encryptClinicalData, newTenantDataKey, unwrapTenantDataKey, wrapTenantDataKey,
} from './encryption';
import {
  type AnamnesisBody, type AnamnesisPatch, type AnthropometryBody, type BodyCompositionInput,
  type TemplateBody, type TemplatePatch, type TemplateField,
} from './validation';

type Tx = Prisma.TransactionClient;
type KeyStore = {
  tenantDataEncryptionKey: {
    findUnique(args: { where: { accountId: string } }): Promise<{ wrappedKey: string } | null>;
    upsert(args: {
      where: { accountId: string };
      create: { accountId: string; wrappedKey: string };
      update: Record<string, never>;
    }): Promise<{ wrappedKey: string }>;
  };
};
const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);
const FORBIDDEN = { ok: false as const, reason: 'forbidden' as const };
const NOT_FOUND = { ok: false as const, reason: 'not_found' as const };
const CONSENT_REQUIRED = { ok: false as const, reason: 'consent_required' as const };

export interface ClinicalFailure {
  ok: false;
  reason: string;
  errors?: string[];
}

function dtoTemplate(template: {
  id: string; name: string; currentVersion: number; createdAt: Date; updatedAt: Date;
  versions?: { id: string; version: number; name: string; fields: Prisma.JsonValue; createdAt: Date }[];
}) {
  return {
    id: template.id, name: template.name, currentVersion: template.currentVersion,
    createdAt: template.createdAt, updatedAt: template.updatedAt,
    versions: template.versions?.map((v) => ({ id: v.id, version: v.version, name: v.name, fields: v.fields, createdAt: v.createdAt })),
  };
}

function validateAnswers(fields: TemplateField[], answers: Record<string, unknown>, complete: boolean): string[] {
  const errors: string[] = [];
  const known = new Set(fields.map((f) => f.id));
  if (Object.keys(answers).some((key) => !known.has(key))) errors.push('unknown_field');
  for (const field of fields) {
    const value = answers[field.id];
    const blank = value === undefined || value === null || value === '';
    if (blank) {
      if (complete && field.required) errors.push(`required:${field.id}`);
      continue;
    }
    if (field.type === 'text' && (typeof value !== 'string' || value.length > 5000)) errors.push(`invalid:${field.id}`);
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`invalid:${field.id}`);
    if (field.type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
      errors.push(`invalid:${field.id}`);
    }
    if (field.type === 'single' && (typeof value !== 'string' || !field.options?.includes(value))) errors.push(`invalid:${field.id}`);
    if (field.type === 'multiple' && (!Array.isArray(value) || value.length > (field.options?.length ?? 0)
      || value.some((v) => typeof v !== 'string' || !field.options?.includes(v))
      || new Set(value).size !== value.length)) errors.push(`invalid:${field.id}`);
  }
  return errors;
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

async function encryptForTenant(
  tx: KeyStore,
  accountId: string,
  recordId: string,
  kind: 'ANAMNESIS_ANSWERS' | 'ANTHROPOMETRY',
  value: unknown,
): Promise<string> {
  const key = await ensureTenantDataKey(tx, accountId);
  try {
    return encryptClinicalData(accountId, recordId, kind, value, key);
  } finally {
    key.fill(0);
  }
}

async function anamnesisDto<T extends {
  id: string;
  accountId: string;
  answersCiphertext: string | null;
  legacyAnswers: Prisma.JsonValue | null;
}>(tx: KeyStore, record: T): Promise<Omit<T, 'answersCiphertext' | 'legacyAnswers'> & { answers: Prisma.JsonValue }> {
  const { answersCiphertext, legacyAnswers, ...metadata } = record;
  let answers: Prisma.JsonValue;
  if (answersCiphertext) {
    const key = await existingTenantDataKey(tx, record.accountId);
    try {
      answers = decryptClinicalData(
        record.accountId, record.id, 'ANAMNESIS_ANSWERS', answersCiphertext, key,
      ) as Prisma.JsonValue;
    } finally {
      key.fill(0);
    }
  } else if (legacyAnswers !== null) {
    answers = legacyAnswers;
  } else {
    throw new Error('respostas clínicas ausentes');
  }
  return { ...metadata, answers };
}

type AnthropometryPayload = {
  measuredAt: string;
  weightKg: number;
  heightCm: number;
  bmi: number;
  waistCm: number | null;
  hipCm: number | null;
  neckCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  bodyComposition?: BodyCompositionPayload | null;
};

type BodyCompositionPayload = {
  method: 'BIOIMPEDANCE' | 'JACKSON_POLLOCK_3_SITE';
  formula: string;
  rawInputs: Record<string, string | number>;
  derivedValues: {
    bodyFatPercent: number;
    fatMassKg: number;
    fatFreeMassKg: number;
  };
};

async function anthropometryDto(tx: KeyStore, record: Prisma.AnthropometryRecordGetPayload<{}>) {
  const {
    clinicalDataCiphertext, measuredAt: legacyMeasuredAt, weightKg: legacyWeightKg,
    heightCm: legacyHeightCm, bmi: legacyBmi, waistCm: legacyWaistCm,
    hipCm: legacyHipCm, neckCm: legacyNeckCm, armCm: legacyArmCm, thighCm: legacyThighCm,
    ...metadata
  } = record;
  let data: AnthropometryPayload;
  if (clinicalDataCiphertext) {
    const key = await existingTenantDataKey(tx, record.accountId);
    try {
      data = decryptClinicalData(
        record.accountId, record.id, 'ANTHROPOMETRY', clinicalDataCiphertext, key,
      ) as AnthropometryPayload;
    } finally {
      key.fill(0);
    }
  } else if (legacyMeasuredAt && legacyWeightKg && legacyHeightCm && legacyBmi) {
    data = {
      measuredAt: legacyMeasuredAt.toISOString(),
      weightKg: Number(legacyWeightKg),
      heightCm: Number(legacyHeightCm),
      bmi: Number(legacyBmi),
      waistCm: legacyWaistCm === null ? null : Number(legacyWaistCm),
      hipCm: legacyHipCm === null ? null : Number(legacyHipCm),
      neckCm: legacyNeckCm === null ? null : Number(legacyNeckCm),
      armCm: legacyArmCm === null ? null : Number(legacyArmCm),
      thighCm: legacyThighCm === null ? null : Number(legacyThighCm),
    };
  } else {
    throw new Error('medidas clínicas ausentes');
  }
  return {
    ...metadata,
    measuredAt: data.measuredAt,
    weightKg: String(data.weightKg),
    heightCm: String(data.heightCm),
    bmi: String(data.bmi),
    waistCm: data.waistCm === null ? null : String(data.waistCm),
    hipCm: data.hipCm === null ? null : String(data.hipCm),
    neckCm: data.neckCm === null ? null : String(data.neckCm),
    armCm: data.armCm === null ? null : String(data.armCm),
    thighCm: data.thighCm === null ? null : String(data.thighCm),
    bodyComposition: data.bodyComposition ?? null,
  };
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function calculateBodyComposition(input: BodyCompositionInput, weightKg: number) {
  let bodyFatPercent: number;
  let formula: string;
  let rawInputs: Record<string, string | number>;
  if (input.method === 'BIOIMPEDANCE') {
    bodyFatPercent = input.bodyFatPercent;
    formula = 'Bioimpedância: leitura de percentual de gordura informada pelo equipamento (sem equação estimada)';
    rawInputs = {
      bodyFatPercent: input.bodyFatPercent,
      ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
    };
  } else {
    const sum = input.sexAtBirth === 'male'
      ? input.chestMm! + input.abdomenMm! + input.thighMm!
      : input.tricepsMm! + input.suprailiacMm! + input.thighMm!;
    const density = input.sexAtBirth === 'male'
      ? 1.10938 - 0.0008267 * sum + 0.0000016 * (sum ** 2) - 0.0002574 * input.ageYears
      : 1.0994921 - 0.0009929 * sum + 0.0000023 * (sum ** 2) - 0.0001392 * input.ageYears;
    bodyFatPercent = 495 / density - 450;
    formula = input.sexAtBirth === 'male'
      ? 'Jackson–Pollock 3 sítios masculino: DC = 1.10938 − 0.0008267Σ + 0.0000016Σ² − 0.0002574×idade; Siri: %GC = 495/DC − 450'
      : 'Jackson–Pollock 3 sítios feminino: DC = 1.0994921 − 0.0009929Σ + 0.0000023Σ² − 0.0001392×idade; Siri: %GC = 495/DC − 450';
    rawInputs = input.sexAtBirth === 'male'
      ? {
        sexAtBirth: input.sexAtBirth, ageYears: input.ageYears, chestMm: input.chestMm!,
        abdomenMm: input.abdomenMm!, thighMm: input.thighMm!,
      }
      : {
        sexAtBirth: input.sexAtBirth, ageYears: input.ageYears, tricepsMm: input.tricepsMm!,
        suprailiacMm: input.suprailiacMm!, thighMm: input.thighMm!,
      };
  }
  if (!Number.isFinite(bodyFatPercent) || bodyFatPercent < 0 || bodyFatPercent > 75) {
    return { ok: false as const, errors: ['body_fat_out_of_range'] };
  }
  const roundedBodyFatPercent = roundTo(bodyFatPercent, 1);
  const fatMassKg = weightKg * roundedBodyFatPercent / 100;
  return {
    ok: true as const,
    data: {
      method: input.method,
      formula,
      rawInputs,
      derivedValues: {
        bodyFatPercent: roundedBodyFatPercent,
        fatMassKg: roundTo(fatMassKg, 2),
        fatFreeMassKg: roundTo(weightKg - fatMassKg, 2),
      },
    } satisfies BodyCompositionPayload,
  };
}

export function normalizeAnthropometry(input: AnthropometryBody) {
  const weightKg = input.weightUnit === 'lb' ? input.weight / 2.2046226218 : input.weight;
  const heightCm = input.heightUnit === 'm' ? input.height * 100 : input.height;
  const measures = [input.waistCm, input.hipCm, input.neckCm, input.armCm, input.thighCm];
  if (!Number.isFinite(weightKg) || weightKg < 1 || weightKg > 500) return { ok: false as const, errors: ['weight_out_of_range'] };
  if (!Number.isFinite(heightCm) || heightCm < 30 || heightCm > 250) return { ok: false as const, errors: ['height_out_of_range'] };
  if (measures.some((v) => v !== undefined && v !== null && (v < 10 || v > 300))) return { ok: false as const, errors: ['measure_out_of_range'] };
  const bodyComposition = input.bodyComposition
    ? calculateBodyComposition(input.bodyComposition, weightKg)
    : null;
  if (bodyComposition && !bodyComposition.ok) return bodyComposition;
  const weight = Math.round(weightKg * 100) / 100;
  const height = Math.round(heightCm * 100) / 100;
  const bmi = Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10;
  return {
    ok: true as const,
    errors: [] as string[],
    weightKg: weight,
    heightCm: height,
    bmi,
    waistCm: input.waistCm ?? null,
    hipCm: input.hipCm ?? null,
    neckCm: input.neckCm ?? null,
    armCm: input.armCm ?? null,
    thighCm: input.thighCm ?? null,
    bodyComposition: bodyComposition?.data ?? null,
  };
}

export function createClinicalService({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  async function patientWithConsent(tx: Tx, patientId: string) {
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

  async function listTemplates(s: SessionInfo) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const rows = await tx.anamnesisTemplate.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      });
      return { ok: true as const, items: rows.map((r) => dtoTemplate(r)) };
    }, db);
  }

  async function getTemplate(s: SessionInfo, id: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const row = await tx.anamnesisTemplate.findFirst({
        where: { id }, include: { versions: { orderBy: { version: 'asc' } } },
      });
      return row ? { ok: true as const, template: dtoTemplate(row) } : NOT_FOUND;
    }, db);
  }

  async function createTemplate(s: SessionInfo, input: TemplateBody) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const fields = input.fields as unknown as Prisma.InputJsonValue;
    return withTenant(s.accountId, async (tx) => {
      const template = await tx.anamnesisTemplate.create({
        data: {
          accountId: s.accountId, name: input.name.trim(), currentVersion: 1,
          createdByUserId: s.userId,
          versions: { create: { version: 1, name: input.name.trim(), fields, createdByUserId: s.userId } },
        },
        include: { versions: true },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANAMNESIS_TEMPLATE_CREATED',
        resource: 'AnamnesisTemplate', resourceId: template.id, createdAt: now(),
      } });
      return { ok: true as const, template: dtoTemplate(template) };
    }, db);
  }

  async function updateTemplate(s: SessionInfo, id: string, input: TemplatePatch) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`clinical-template-${s.accountId}-${id}`}))`;
      const current = await tx.anamnesisTemplate.findFirst({
        where: { id },
      });
      if (!current) return NOT_FOUND;
      const previousVersion = await tx.anamnesisTemplateVersion.findFirst({
        where: { templateId: id }, orderBy: { version: 'desc' },
      });
      if (!previousVersion) return NOT_FOUND;
      const name = input.name?.trim() ?? current.name;
      const fields = (input.fields ?? previousVersion.fields) as Prisma.InputJsonValue;
      const version = current.currentVersion + 1;
      const updated = await tx.anamnesisTemplate.update({
        where: { id },
        data: {
          name, currentVersion: version,
          versions: { create: { version, name, fields, createdByUserId: s.userId } },
        },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANAMNESIS_TEMPLATE_UPDATED',
        resource: 'AnamnesisTemplate', resourceId: id, createdAt: now(),
      } });
      return { ok: true as const, template: dtoTemplate(updated), version };
    }, db);
  }

  async function listAnamneses(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientWithConsent(tx, patientId);
      if (!access.ok) return access;
      const records = await tx.anamnesisRecord.findMany({
        where: { patientId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: { versionSnapshot: { select: { name: true, fields: true } } },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANAMNESIS_LISTED',
        resource: 'Patient', resourceId: patientId, createdAt: now(),
      } });
      const items = await Promise.all(records.map((record) => anamnesisDto(tx, record)));
      return { ok: true as const, items };
    }, db);
  }

  async function getAnamnesis(s: SessionInfo, patientId: string, id: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientWithConsent(tx, patientId);
      if (!access.ok) return access;
      const record = await tx.anamnesisRecord.findFirst({
        where: { id, patientId }, include: { versionSnapshot: true },
      });
      if (!record) return NOT_FOUND;
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANAMNESIS_READ',
        resource: 'AnamnesisRecord', resourceId: id, createdAt: now(),
      } });
      return { ok: true as const, record: await anamnesisDto(tx, record) };
    }, db);
  }

  async function createAnamnesis(s: SessionInfo, patientId: string, input: AnamnesisBody) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientWithConsent(tx, patientId);
      if (!access.ok) return access;
      if (access.patient.status !== 'ACTIVE') return { ok: false as const, reason: 'patient_archived' };
      const template = await tx.anamnesisTemplate.findFirst({
        where: { id: input.templateId },
      });
      if (!template) return NOT_FOUND;
      const version = await tx.anamnesisTemplateVersion.findFirst({
        where: { templateId: template.id, version: template.currentVersion },
      });
      if (!version) return NOT_FOUND;
      const fields = version.fields as unknown as TemplateField[];
      const errors = validateAnswers(fields, input.answers, input.status === 'COMPLETED');
      if (errors.length) return { ok: false as const, reason: 'validation', errors };
      const id = randomUUID();
      const answersCiphertext = await encryptForTenant(
        tx, s.accountId, id, 'ANAMNESIS_ANSWERS', input.answers,
      );
      const record = await tx.anamnesisRecord.create({
        data: {
          id,
          accountId: s.accountId, patientId, templateId: template.id, templateVersionId: version.id,
          templateVersion: version.version, answersCiphertext, status: input.status,
          createdByUserId: s.userId, updatedByUserId: s.userId,
          createdAt: now(), updatedAt: now(), completedAt: input.status === 'COMPLETED' ? now() : null,
        },
        include: { versionSnapshot: true },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANAMNESIS_CREATED',
        resource: 'AnamnesisRecord', resourceId: record.id, createdAt: now(),
      } });
      return { ok: true as const, record: await anamnesisDto(tx, record) };
    }, db);
  }

  async function updateAnamnesis(s: SessionInfo, patientId: string, id: string, input: AnamnesisPatch) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientWithConsent(tx, patientId);
      if (!access.ok) return access;
      const current = await tx.anamnesisRecord.findFirst({
        where: { id, patientId }, include: { versionSnapshot: true },
      });
      if (!current) return NOT_FOUND;
      if (input.status === 'DRAFT' && current.status === 'COMPLETED') {
        return { ok: false as const, reason: 'not_editable' };
      }
      const currentDto = await anamnesisDto(tx, current);
      const answers = input.answers ?? currentDto.answers;
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return { ok: false as const, reason: 'validation', errors: ['answers_must_be_object'] };
      }
      const targetStatus = input.status ?? current.status as 'DRAFT' | 'COMPLETED';
      const errors = validateAnswers(current.versionSnapshot.fields as unknown as TemplateField[], answers as Record<string, unknown>, targetStatus === 'COMPLETED');
      if (errors.length) return { ok: false as const, reason: 'validation', errors };
      const answersCiphertext = await encryptForTenant(
        tx, s.accountId, id, 'ANAMNESIS_ANSWERS', answers,
      );
      const record = await tx.anamnesisRecord.update({
        where: { id },
        data: {
          answersCiphertext, legacyAnswers: Prisma.DbNull,
          status: targetStatus,
          updatedByUserId: s.userId,
          updatedAt: now(),
          ...(targetStatus === 'COMPLETED' && !current.completedAt ? { completedAt: now() } : {}),
        },
        include: { versionSnapshot: true },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANAMNESIS_UPDATED',
        resource: 'AnamnesisRecord', resourceId: id, createdAt: now(),
      } });
      return { ok: true as const, record: await anamnesisDto(tx, record) };
    }, db);
  }

  async function listAnthropometry(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    return withTenant(s.accountId, async (tx) => {
      const access = await patientWithConsent(tx, patientId);
      if (!access.ok) return access;
      const items = await tx.anthropometryRecord.findMany({
        where: { patientId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANTHROPOMETRY_LISTED',
        resource: 'Patient', resourceId: patientId, createdAt: now(),
      } });
      return {
        ok: true as const, items: await Promise.all(items.map((item) => anthropometryDto(tx, item))),
        bmiClassification: 'NOT_CLASSIFIED' as const,
      };
    }, db);
  }

  async function createAnthropometry(s: SessionInfo, patientId: string, input: AnthropometryBody) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const normalized = normalizeAnthropometry(input);
    if (!normalized.ok) return { ok: false as const, reason: 'validation', errors: normalized.errors };
    const measuredAt = input.measuredAt ? new Date(input.measuredAt) : now();
    if (measuredAt.getTime() > now().getTime()) return { ok: false as const, reason: 'validation', errors: ['measured_at_in_future'] };
    return withTenant(s.accountId, async (tx) => {
      const access = await patientWithConsent(tx, patientId);
      if (!access.ok) return access;
      if (access.patient.status !== 'ACTIVE') return { ok: false as const, reason: 'patient_archived' };
      const id = randomUUID();
      const measuredAtIso = measuredAt.toISOString();
      const clinicalData: AnthropometryPayload = {
        measuredAt: measuredAtIso,
        weightKg: normalized.weightKg,
        heightCm: normalized.heightCm,
        bmi: normalized.bmi,
        waistCm: normalized.waistCm,
        hipCm: normalized.hipCm,
        neckCm: normalized.neckCm,
        armCm: normalized.armCm,
        thighCm: normalized.thighCm,
        bodyComposition: normalized.bodyComposition,
      };
      const clinicalDataCiphertext = await encryptForTenant(
        tx, s.accountId, id, 'ANTHROPOMETRY', clinicalData,
      );
      const record = await tx.anthropometryRecord.create({
        data: {
          id, accountId: s.accountId, patientId, clinicalDataCiphertext,
          createdByUserId: s.userId, createdAt: now(),
        },
      });
      await tx.auditLog.create({ data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'ANTHROPOMETRY_CREATED',
        resource: 'AnthropometryRecord', resourceId: record.id, createdAt: now(),
      } });
      return {
        ok: true as const, record: await anthropometryDto(tx, record),
        bmiClassification: 'NOT_CLASSIFIED' as const,
      };
    }, db);
  }

  return {
    listTemplates, getTemplate, createTemplate, updateTemplate,
    listAnamneses, getAnamnesis, createAnamnesis, updateAnamnesis,
    listAnthropometry, createAnthropometry,
  };
}

export const anamnesisDataSource: PatientDataSource = {
  name: 'registros-clinicos',
  collect: async (t, patientId) => {
    const anamneses = await t.anamnesisRecord.findMany({
      where: { patientId }, include: { versionSnapshot: { select: { name: true, version: true, fields: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const anthropometry = await t.anthropometryRecord.findMany({
      where: { patientId }, orderBy: { createdAt: 'asc' },
    });
    return {
      anamneses: await Promise.all(anamneses.map((record) => anamnesisDto(t, record))),
      anthropometry: await Promise.all(anthropometry.map((record) => anthropometryDto(t, record))),
    };
  },
};
