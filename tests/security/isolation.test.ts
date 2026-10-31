import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { prisma, forTenant } from '../../src/db/tenant';
import { adminPrisma, refreshUsageCounters } from '../../src/db/admin';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });

beforeAll(async () => {
  await seedTenants(owner);
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), prisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('Guarda de configuração [seg]', () => {
  it('a aplicação NÃO conecta como superuser nem BYPASSRLS', async () => {
    const [r] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r.rolsuper).toBe(false);
    expect(r.rolbypassrls).toBe(false);
  });

  it('o painel admin NÃO conecta como superuser nem BYPASSRLS', async () => {
    const [r] = await adminPrisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r.rolsuper).toBe(false);
    expect(r.rolbypassrls).toBe(false);
  });
});

describe('US-SEC-01 · isolamento entre tenants [seg]', () => {
  const A = () => forTenant(TENANT_A);

  it('lista apenas pacientes do próprio tenant', async () => {
    const list = await A().patient.findMany();
    expect(list.length).toBe(4);
    expect(list.every((p) => p.accountId === TENANT_A)).toBe(true);
  });

  it('acesso direto por ID a recurso de outro tenant retorna vazio', async () => {
    expect(await A().patient.findUnique({ where: { id: 'pat_b1' } })).toBeNull();
  });

  it('busca por nome não vaza pacientes de outro tenant', async () => {
    expect(await A().patient.findMany({ where: { fullName: { contains: 'B1' } } })).toHaveLength(0);
  });

  it('não altera nem exclui dados de outro tenant', async () => {
    await expect(
      A().patient.update({ where: { id: 'pat_b1' }, data: { fullName: 'invadido' } }),
    ).rejects.toThrow();
    expect((await A().patient.updateMany({ where: { id: 'pat_b1' }, data: { fullName: 'x' } })).count).toBe(0);
    expect((await A().patient.deleteMany({ where: { id: 'pat_b1' } })).count).toBe(0);
    const b = await owner.patient.findUnique({ where: { id: 'pat_b1' } });
    expect(b?.fullName).toBe('Paciente B1');
  });

  it('não cria registro apontando para outro tenant', async () => {
    await expect(
      A().patient.create({ data: { accountId: TENANT_B, fullName: 'injetado' } }),
    ).rejects.toThrow();
  });

  it('sem contexto de tenant, nenhuma linha é visível', async () => {
    expect(await prisma.patient.findMany()).toHaveLength(0);
    expect(await prisma.account.findMany()).toHaveLength(0);
  });

  it('o tenant só enxerga a própria conta', async () => {
    const accounts = await A().account.findMany();
    expect(accounts.map((a) => a.id)).toEqual([TENANT_A]);
  });
});

describe('US-ADM-00 / US-ADM-01 · super-admin sem acesso clínico [seg]', () => {
  const clinical = ['Patient', 'Unit', 'Membership', 'User', 'TermsAcceptance', 'AuditLog', 'AuthAuditLog', 'Food', 'HouseholdMeasure', 'Session', 'EmailToken', 'RecoveryCode', 'Invitation'];

  it.each(clinical)('super-admin recebe acesso negado em "%s"', async (table) => {
    await expect(adminPrisma.$queryRawUnsafe(`SELECT * FROM "${table}" LIMIT 1`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('super-admin enxerga contas, planos e assinaturas', async () => {
    expect((await adminPrisma.account.findMany()).length).toBe(2);
    expect((await adminPrisma.plan.findMany()).length).toBeGreaterThan(0);
    expect((await adminPrisma.subscription.findMany()).length).toBe(2);
  });
});

describe('US-ADM-03 · contadores de uso sem ler conteúdo clínico [api]', () => {
  it('conta pacientes totais e ativos (regra de 90 dias) por tenant', async () => {
    await refreshUsageCounters();
    const rows = await adminPrisma.usageCounter.findMany();
    const a = rows.find((r) => r.accountId === TENANT_A)!;
    const b = rows.find((r) => r.accountId === TENANT_B)!;
    // A: 3 não arquivados, 2 com atividade nos últimos 90 dias (arquivado e inativo ficam de fora)
    expect([a.patientsTotal, a.patientsActive]).toEqual([3, 2]);
    expect([b.patientsTotal, b.patientsActive]).toEqual([2, 2]);
    expect(a.users).toBe(1);
  });

  it('é idempotente no mesmo dia (não duplica linhas)', async () => {
    await refreshUsageCounters();
    await refreshUsageCounters();
    expect(await adminPrisma.usageCounter.count({ where: { accountId: TENANT_A } })).toBe(1);
  });

  it('o tenant lê o próprio contador, mas não o do outro', async () => {
    const rows = await forTenant(TENANT_A).usageCounter.findMany();
    expect(rows.map((r) => r.accountId)).toEqual([TENANT_A]);
  });
});

describe('US-SEC-03 · auditoria imutável [seg]', () => {
  it('a aplicação não consegue editar nem apagar a auditoria', async () => {
    await expect(
      forTenant(TENANT_A).auditLog.updateMany({ data: { action: 'FORJADO' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(forTenant(TENANT_A).auditLog.deleteMany()).rejects.toThrow(/permission denied/i);
  });

  it('nem o dono do schema consegue (trigger)', async () => {
    await expect(owner.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'X'`)).rejects.toThrow(/imutável/);
    await expect(owner.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/imutável/);
  });

  it('a aplicação consegue registrar eventos do próprio tenant', async () => {
    const row = await forTenant(TENANT_A).auditLog.create({
      data: { accountId: TENANT_A, action: 'PATIENT_VIEW', resource: 'Patient', resourceId: 'pat_a1' },
    });
    expect(row.accountId).toBe(TENANT_A);
  });

  it('falhas de login são somente-inserção, não revelam identidade e não ficam legíveis aos papéis', async () => {
    await prisma.$queryRaw`SELECT append_auth_audit('USER_LOGIN_FAILED', '203.0.113.20')`;
    await adminPrisma.$queryRaw`SELECT append_auth_audit('ADMIN_LOGIN_FAILED', '203.0.113.21')`;
    const userEvent = await owner.authAuditLog.findFirstOrThrow({
      where: { action: 'USER_LOGIN_FAILED', sourceIp: '203.0.113.20' },
    });
    const adminEvent = await owner.authAuditLog.findFirstOrThrow({
      where: { action: 'ADMIN_LOGIN_FAILED', sourceIp: '203.0.113.21' },
    });
    expect(userEvent).toMatchObject({ action: 'USER_LOGIN_FAILED', sourceIp: '203.0.113.20' });
    expect(adminEvent).toMatchObject({ action: 'ADMIN_LOGIN_FAILED', sourceIp: '203.0.113.21' });
    await expect(prisma.authAuditLog.findMany()).rejects.toThrow(/permission denied/i);
    await expect(adminPrisma.authAuditLog.findMany()).rejects.toThrow(/permission denied/i);
    await expect(prisma.$executeRaw`INSERT INTO "AuthAuditLog" ("id", "action") VALUES ('app_insert', 'USER_LOGIN_FAILED')`)
      .rejects.toThrow(/permission denied/i);
    await expect(prisma.$queryRaw`SELECT append_auth_audit('OTHER', '203.0.113.22')`)
      .rejects.toThrow(/tipo de auditoria inválido/);
    await expect(prisma.$queryRaw`SELECT append_auth_audit('USER_LOGIN_FAILED', 'nao-e-ip')`)
      .rejects.toThrow(/inet/i);
    await expect(owner.authAuditLog.update({ where: { id: userEvent.id }, data: { action: 'X' } })).rejects.toThrow(/imutável/);
    await expect(owner.authAuditLog.delete({ where: { id: adminEvent.id } })).rejects.toThrow(/imutável/);
  });
});
