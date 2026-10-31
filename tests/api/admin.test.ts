import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A } from '../../prisma/seed-data';
import { hashPassword } from '../../src/auth/password';
import { encryptSecret } from '../../src/crypto/secrets';
import { generateSecret, totpCode } from '../../src/auth/totp';
import { POST as adminLogin } from '@/app/api/admin/login/route';
import { POST as adminLogout } from '@/app/api/admin/logout/route';
import { GET as tenants } from '@/app/api/admin/tenants/route';
import { GET as tenantsCsv } from '@/app/api/admin/tenants/export/route';
import { GET as tenantDetail } from '@/app/api/admin/tenants/[id]/route';
import { POST as suspend } from '@/app/api/admin/tenants/[id]/suspend/route';
import { POST as reactivate } from '@/app/api/admin/tenants/[id]/reactivate/route';
import { POST as extendTrial } from '@/app/api/admin/tenants/[id]/extend-trial/route';
import { call, cookieOf, randomIp } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
const totp = generateSecret();
const EMAIL = 'dono-api@example.test';
const PASS = 'Admin-Senha-123';
let cookie = '';

beforeAll(async () => {
  await seedTenants(owner);
  await owner.platformAdmin.create({ data: { id: 'adm_api', email: EMAIL, passwordHash: await hashPassword(PASS), totpSecret: encryptSecret(totp) } });
  await adminDb.$executeRaw`SELECT refresh_usage_counters()`;
});
afterAll(async () => { await Promise.all([owner.$disconnect(), adminDb.$disconnect()]); });

describe('API · login do super-admin [seg]', () => {
  it('sem código, com código errado ou com senha errada: mesma resposta 401', async () => {
    const a = await call(adminLogin, { body: { email: EMAIL, password: PASS, code: '000000' } });
    const b = await call(adminLogin, { body: { email: EMAIL, password: 'errada', code: totpCode(totp, Date.now()) } });
    const c = await call(adminLogin, { body: { email: 'ninguem@example.test', password: PASS, code: '000000' } });
    expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
    expect(a.text).toBe(b.text);
    expect(b.text).toBe(c.text);
  });

  it('senha + código válidos abrem a sessão do painel; o código não pode ser reutilizado', async () => {
    const code = totpCode(totp, Date.now() + 30_000); // passo ainda não usado
    const r = await call(adminLogin, { body: { email: EMAIL, password: PASS, code } });
    expect(r.status).toBe(200);
    cookie = cookieOf(r, 'sn_admin');
    expect(r.setCookies[0]).toContain('HttpOnly');
    expect((await call(adminLogin, { body: { email: EMAIL, password: PASS, code } })).status).toBe(401);
  });

  it('limite de tentativas: a 6ª tentativa do mesmo IP recebe 429', async () => {
    const ip = randomIp();
    for (let i = 0; i < 5; i++) await call(adminLogin, { ip, body: { email: 'x@example.test', password: 'x', code: '000000' } });
    expect((await call(adminLogin, { ip, body: { email: 'x@example.test', password: 'x', code: '000000' } })).status).toBe(429);
  });
});

describe('API · painel do dono [seg]', () => {
  it('sem sessão de admin, tudo é 401', async () => {
    expect((await call(tenants, { method: 'GET' })).status).toBe(401);
    expect((await call(tenantsCsv, { method: 'GET' })).status).toBe(401);
    expect((await call(tenantDetail, { method: 'GET', params: { id: TENANT_A } })).status).toBe(401);
    expect((await call(suspend, { params: { id: TENANT_A }, body: { reason: 'x' } })).status).toBe(401);
  });

  it('lista tenants com contagens e nunca expõe dados de pacientes', async () => {
    const list = await call(tenants, { method: 'GET', cookie, url: 'http://localhost/api/admin/tenants?plan=clinico-30' });
    expect(list.status).toBe(200);
    const a = list.json.tenants.find((t: any) => t.id === TENANT_A);
    expect(a).toMatchObject({ patientsTotal: 3, patientsActive: 2, users: 1, plan: 'clinico-30' });

    const detail = await call(tenantDetail, { method: 'GET', cookie, params: { id: TENANT_A } });
    const csv = await call(tenantsCsv, { method: 'GET', cookie });
    const everything = list.text + detail.text + csv.text;
    for (const leak of ['Paciente A1', 'Paciente A2', 'Paciente B1', 'pat_a1']) expect(everything).not.toContain(leak);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('attachment');
    expect(csv.text.split('\n')[0]).toBe('id,nome,email,plano,status,pacientes_total,pacientes_ativos,usuarios,cadastro,ultimo_acesso');
  });

  it('filtros inválidos na URL são ignorados em vez de gerar erro', async () => {
    const r = await call(tenants, { method: 'GET', cookie, url: 'http://localhost/api/admin/tenants?status=HACK&band=999&inactiveDays=abc' });
    expect(r.status).toBe(200);
    expect(r.json.tenants.length).toBeGreaterThanOrEqual(2);
  });

  it('suspender exige motivo, é auditado; reativar e estender trial respeitam as regras', async () => {
    expect((await call(suspend, { cookie, params: { id: TENANT_A }, body: { reason: '' } })).status).toBe(400);
    expect((await call(suspend, { cookie, params: { id: TENANT_A }, body: { reason: 'análise de fraude' } })).status).toBe(200);
    expect((await call(suspend, { cookie, params: { id: TENANT_A }, body: { reason: 'de novo' } })).status).toBe(409);
    const log = await owner.adminAuditLog.findFirstOrThrow({ where: { action: 'ACCOUNT_SUSPENDED', targetAccountId: TENANT_A } });
    expect(log.adminId).toBe('adm_api');

    expect((await call(reactivate, { cookie, params: { id: TENANT_A } })).json).toEqual({ ok: true, status: 'TRIAL' });
    expect((await call(extendTrial, { cookie, params: { id: TENANT_A }, body: { days: 7 } })).status).toBe(200);
    expect((await call(extendTrial, { cookie, params: { id: TENANT_A }, body: { days: 90 } })).status).toBe(422);
    expect((await call(tenantDetail, { method: 'GET', cookie, params: { id: 'nao_existe' } })).status).toBe(404);
  });

  it('logout encerra a sessão do painel na hora', async () => {
    expect((await call(adminLogout, { cookie })).status).toBe(200);
    expect((await call(tenants, { method: 'GET', cookie })).status).toBe(401);
  });
});
