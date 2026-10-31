import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeName } from '../src/foods/normalize';

export const TENANT_A = 'tenant_a';
export const TENANT_B = 'tenant_b';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** Dois tenants fixos com dados 100% sintéticos (A e B), usados em toda a suíte. */
export async function seedTenants(db: PrismaClient) {
  await db.$executeRawUnsafe(
    'TRUNCATE "Account","User","Plan","FoodTable","PlatformAdmin","PaymentEvent" RESTART IDENTITY CASCADE',
  );

  const plan = await db.plan.create({
    data: {
      id: 'plan_clinico_30',
      code: 'clinico-30',
      name: 'Clínico até 30 pacientes',
      priceCents: 4900,
      modules: ['CLINICO'],
      patientLimit: 30,
      userLimit: 2,
      storageMb: 500,
      activePatientDays: 90,
    },
  });

  await db.plan.create({
    data: { id: 'plan_trial', code: 'trial', name: 'Trial 14 dias', priceCents: 0, modules: ['CLINICO'], patientLimit: 15, userLimit: 1, storageMb: 100 },
  });

  for (const [id, name, email] of [
    [TENANT_A, 'Nutri A (sintético)', 'a@example.test'],
    [TENANT_B, 'Nutri B (sintético)', 'b@example.test'],
  ] as const) {
    await db.account.create({ data: { id, name, email } });
    await db.unit.create({ data: { id: `${id}_unit`, accountId: id, name: 'Consultório', isDefault: true } });
    await db.user.create({ data: { id: `${id}_user`, email, passwordHash: 'x', name: name } });
    await db.membership.create({ data: { accountId: id, userId: `${id}_user`, role: 'TITULAR' } });
    await db.subscription.create({ data: { accountId: id, planId: plan.id } });
    await db.auditLog.create({
      data: { id: `${id}_audit1`, accountId: id, actorUserId: `${id}_user`, action: 'LOGIN', resource: 'session' },
    });
  }

  const patients: Prisma.PatientCreateManyInput[] = [
      { id: 'pat_a1', accountId: TENANT_A, fullName: 'Paciente A1', lastActivityAt: ago(1) },
      { id: 'pat_a2', accountId: TENANT_A, fullName: 'Paciente A2', lastActivityAt: ago(10) },
      { id: 'pat_a3', accountId: TENANT_A, fullName: 'Paciente A3 (inativo)', lastActivityAt: ago(200) },
      { id: 'pat_a4', accountId: TENANT_A, fullName: 'Paciente A4 (arquivado)', status: 'ARCHIVED', archivedAt: ago(5) },
      { id: 'pat_b1', accountId: TENANT_B, fullName: 'Paciente B1', lastActivityAt: ago(2) },
      { id: 'pat_b2', accountId: TENANT_B, fullName: 'Paciente B2', lastActivityAt: ago(3) },
  ];
  await db.patient.createMany({ data: patients.map((p) => ({ ...p, normalizedName: normalizeName(p.fullName) })) });
}
