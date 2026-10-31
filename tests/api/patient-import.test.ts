import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { GET as me } from '@/app/api/me/route';
import { POST as patientImport } from '@/app/api/patients/import/route';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function tenant(prefix: string) {
  const email = uniq(prefix);
  await call(signup, { body: { accountName: prefix, userName: prefix, email, password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true } });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const { accountId } = (await call(me, { method: 'GET', cookie })).json;
  const user = await owner.user.findUniqueOrThrow({ where: { email } });
  return {
    cookie, accountId,
    asSecretary: () => owner.membership.updateMany({ where: { userId: user.id }, data: { role: 'SECRETARIA' } }),
  };
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API · importação de pacientes CSV [e2e]', () => {
  it('valida todas as linhas antes de gravar qualquer paciente', async () => {
    const t = await tenant('import-invalid');
    const csv = 'nome,email,telefone\nAna,,11999990000\n,xx,12\n';
    const preview = await call(patientImport, { cookie: t.cookie, body: { action: 'preview', csv } });
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({ validCount: 1, rows: [{ row: 2, errors: [] }, { row: 3, errors: ['name_required', 'email_invalid', 'phone_invalid'] }] });

    const confirmed = await call(patientImport, { cookie: t.cookie, body: { action: 'confirm', csv } });
    expect([confirmed.status, confirmed.json.error.code]).toEqual([422, 'validation']);
    expect(await owner.patient.count({ where: { accountId: t.accountId } })).toBe(0);
  });

  it('importa atomicamente, exige confirmação explícita de CPF duplicado e respeita isolamento e consentimento', async () => {
    const a = await tenant('import-a');
    const b = await tenant('import-b');
    const csv = 'nome,email,telefone,cpf\nPaciente CSV,,11999990000,529.982.247-25\n';
    const preview = await call(patientImport, { cookie: a.cookie, body: { action: 'preview', csv } });
    expect(preview.json).toMatchObject({ validCount: 1, duplicateRows: [] });

    const imported = await call(patientImport, { cookie: a.cookie, body: { action: 'confirm', csv } });
    expect([imported.status, imported.json.imported]).toEqual([201, 1]);
    expect(await owner.patient.count({ where: { accountId: a.accountId, cpf: '52998224725' } })).toBe(1);
    expect(await owner.patientConsent.count({ where: { accountId: a.accountId } })).toBe(0);

    const ownDuplicate = await call(patientImport, { cookie: a.cookie, body: { action: 'preview', csv } });
    expect(ownDuplicate.json.duplicateRows).toEqual([2]);
    const blocked = await call(patientImport, { cookie: a.cookie, body: { action: 'confirm', csv } });
    expect([blocked.status, blocked.json.error.code, blocked.json.error.rows]).toEqual([409, 'duplicate_cpf', [2]]);

    const otherTenant = await call(patientImport, { cookie: b.cookie, body: { action: 'preview', csv } });
    expect(otherTenant.json.duplicateRows).toEqual([]);
    const confirmed = await call(patientImport, {
      cookie: a.cookie,
      body: { action: 'confirm', csv, confirmDuplicates: true },
    });
    expect([confirmed.status, confirmed.json.imported]).toEqual([201, 1]);
    expect(await owner.patient.count({ where: { accountId: a.accountId, cpf: '52998224725' } })).toBe(2);
  });

  it('requer sessão e papel clínico autorizado para importar', async () => {
    const csv = 'nome,telefone\nAna,11999990000\n';
    expect((await call(patientImport, { body: { action: 'preview', csv } })).status).toBe(401);
    const t = await tenant('import-role');
    await t.asSecretary();
    expect((await call(patientImport, { cookie: t.cookie, body: { action: 'preview', csv } })).status).toBe(403);
  });
});
