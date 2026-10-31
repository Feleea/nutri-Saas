import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { forTenant } from '../../src/db/tenant';
import { adminPrisma } from '../../src/db/admin';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
let patientA: string;
let patientB: string;
let templateA: string;
let versionA: string;
let recordA: string;
let measurementA: string;
let recordB: string;

beforeAll(async () => {
  await seedTenants(owner);
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const pA = await owner.patient.create({ data: { accountId: TENANT_A, fullName: `clínico A ${suffix}`, phone: '11999990000' } });
  const pB = await owner.patient.create({ data: { accountId: TENANT_B, fullName: `clínico B ${suffix}`, phone: '11999990000' } });
  patientA = pA.id;
  patientB = pB.id;

  const tA = await owner.anamnesisTemplate.create({
    data: {
      accountId: TENANT_A, name: 'Modelo A', createdByUserId: 'owner-test',
      versions: { create: { version: 1, name: 'Modelo A', fields: [{ id: 'campo', label: 'Campo', type: 'text' }], createdByUserId: 'owner-test' } },
    },
    include: { versions: true },
  });
  templateA = tA.id;
  versionA = tA.versions[0].id;
  const a = await owner.anamnesisRecord.create({
    data: {
      accountId: TENANT_A, patientId: patientA, templateId: templateA, templateVersionId: versionA,
      templateVersion: 1, answers: { campo: 'sintético' }, createdByUserId: 'owner-test',
      updatedByUserId: 'owner-test', status: 'DRAFT',
    },
  });
  recordA = a.id;
  const bTemplate = await owner.anamnesisTemplate.create({
    data: {
      accountId: TENANT_B, name: 'Modelo B', createdByUserId: 'owner-test',
      versions: { create: { version: 1, name: 'Modelo B', fields: [], createdByUserId: 'owner-test' } },
    },
    include: { versions: true },
  });
  const b = await owner.anamnesisRecord.create({
    data: {
      accountId: TENANT_B, patientId: patientB, templateId: bTemplate.id, templateVersionId: bTemplate.versions[0].id,
      templateVersion: 1, answers: {}, createdByUserId: 'owner-test', updatedByUserId: 'owner-test', status: 'DRAFT',
    },
  });
  recordB = b.id;
  const m = await owner.anthropometryRecord.create({
    data: {
      accountId: TENANT_A, patientId: patientA, measuredAt: new Date(), weightKg: 70, heightCm: 175,
      bmi: 22.9, createdByUserId: 'owner-test',
    },
  });
  measurementA = m.id;
});

afterAll(async () => { await Promise.all([owner.$disconnect(), app.$disconnect(), adminPrisma.$disconnect()]); });

describe('isolamento dos dados clínicos [seg]', () => {
  it('RLS filtra anamneses e antropometria por tenant', async () => {
    const tenantA = forTenant(TENANT_A, undefined, app);
    expect(await tenantA.anamnesisRecord.findUnique({ where: { id: recordA } })).toMatchObject({ accountId: TENANT_A });
    expect(await tenantA.anamnesisRecord.findUnique({ where: { id: recordB } })).toBeNull();
    expect(await tenantA.anthropometryRecord.findUnique({ where: { id: measurementA } })).toMatchObject({ accountId: TENANT_A });
    expect(await tenantA.patient.findUnique({ where: { id: patientB } })).toBeNull();
  });

  it('chave composta rejeita vínculo de prontuário com paciente de outro tenant', async () => {
    await expect(forTenant(TENANT_A, undefined, app).anamnesisRecord.create({
      data: {
        accountId: TENANT_A, patientId: patientB, templateId: templateA, templateVersionId: versionA,
        templateVersion: 1, answers: { campo: 'não deve persistir' }, createdByUserId: 'teste',
        updatedByUserId: 'teste',
      },
    })).rejects.toThrow();
  });

  it.each(['AnamnesisTemplate', 'AnamnesisTemplateVersion', 'AnamnesisRecord', 'AnthropometryRecord'])(
    'painel admin não tem SELECT em %s',
    async (table) => {
      await expect(adminPrisma.$queryRawUnsafe(`SELECT * FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    },
  );

  it('snapshots de modelo e medições não podem ser alterados pela aplicação nem pelo dono do schema', async () => {
    const tenantA = forTenant(TENANT_A, undefined, app);
    await expect(tenantA.anamnesisTemplateVersion.updateMany({ data: { name: 'alterado' } })).rejects.toThrow(/permission denied/i);
    await expect(tenantA.anthropometryRecord.updateMany({ data: { bmi: 1 } })).rejects.toThrow(/permission denied/i);
    await expect(owner.anamnesisTemplateVersion.update({ where: { id: versionA }, data: { name: 'alterado' } })).rejects.toThrow(/imutável/i);
    await expect(owner.anthropometryRecord.update({ where: { id: measurementA }, data: { bmi: 1 } })).rejects.toThrow(/imutável/i);
  });

  it('excluir paciente remove o prontuário e as medidas em cascata', async () => {
    await owner.patient.delete({ where: { id: patientA } });
    expect(await owner.anamnesisRecord.findUnique({ where: { id: recordA } })).toBeNull();
    expect(await owner.anthropometryRecord.findUnique({ where: { id: measurementA } })).toBeNull();
  });
});
