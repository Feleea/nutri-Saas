import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { signBody } from '../../src/billing/gateway';
import { ACTIONS } from '../../src/server/permissions';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { GET as me } from '@/app/api/me/route';
import { POST as exportPatient } from '@/app/api/patients/[id]/export/route';
import { GET as download } from '@/app/api/exports/[token]/route';
import { POST as deletePatient, GET as deletionInfo } from '@/app/api/patients/[id]/delete/route';
import { POST as createFood } from '@/app/api/foods/route';
import { GET as searchFoods } from '@/app/api/foods/search/route';
import { POST as checkout } from '@/app/api/billing/checkout/route';
import { POST as webhook } from '@/app/api/webhooks/gateway/route';
import { GET as adminTenants } from '@/app/api/admin/tenants/route';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const root = fileURLToPath(new URL('../../', import.meta.url));

async function tenant(prefix: string) {
  const email = uniq(prefix);
  await call(signup, { body: { accountName: prefix, userName: prefix, email, password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true } });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const { accountId } = (await call(me, { method: 'GET', cookie })).json;
  const user = await owner.user.findUniqueOrThrow({ where: { email } });
  const asRole = (role: 'TITULAR' | 'PROFISSIONAL' | 'SECRETARIA') =>
    owner.membership.updateMany({ where: { userId: user.id }, data: { role } });
  return { email, cookie, accountId, asRole };
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === 'route.ts' ? [p] : [];
  });
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('Inventário de rotas · nenhuma rota sai sem autenticação declarada [seg]', () => {
  const files = routeFiles(join(root, 'app/api'));

  it('encontra as rotas da API', () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it('toda rota declara auth; rotas de sessão declaram uma ação válida; rotas públicas têm limite de requisições', async () => {
    const problems: string[] = [];
    for (const f of files) {
      const mod = await import(/* @vite-ignore */ f);
      const rel = relative(root, f).split(sep).join('/');
      const handlers = Object.entries(mod).filter(([k]) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(k));
      if (!handlers.length) problems.push(`${rel}: sem handler HTTP`);
      for (const [method, h] of handlers) {
        const meta = (h as { meta?: { auth?: string; action?: string; rateLimit?: unknown } }).meta;
        const id = `${method} ${rel}`;
        if (!meta?.auth) problems.push(`${id}: sem auth declarado`);
        else if (meta.auth === 'session' && !(meta.action && meta.action in ACTIONS)) problems.push(`${id}: sessão sem ação válida`);
        else if (meta.auth === 'public' && !meta.rateLimit) problems.push(`${id}: rota pública sem limite de requisições`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('rotas do painel do dono usam sessão de admin; só o webhook e os jobs dispensam sessão', async () => {
    const odd: string[] = [];
    for (const f of files) {
      const mod = await import(/* @vite-ignore */ f);
      const rel = relative(root, f).split(sep).join('/');
      for (const [k, h] of Object.entries(mod)) {
        const auth = (h as { meta?: { auth?: string } }).meta?.auth;
        if (!auth) continue;
        if (rel.includes('/api/admin/') && !rel.endsWith('admin/login/route.ts') && auth !== 'admin') odd.push(`${k} ${rel}: esperava admin`);
        if (!rel.includes('/api/admin/') && auth === 'admin') odd.push(`${k} ${rel}: admin fora do painel`);
        if (auth === 'webhook' && !rel.endsWith('webhooks/gateway/route.ts')) odd.push(`${k} ${rel}: webhook inesperado`);
        if (auth === 'job' && !rel.includes('/api/jobs/')) odd.push(`${k} ${rel}: job fora de /api/jobs`);
        if (rel.includes('/api/jobs/') && auth !== 'job') odd.push(`${k} ${rel}: esperava job`);
      }
    }
    expect(odd).toEqual([]);
  });
});

describe('API · isolamento entre tenants [seg]', () => {
  it('um tenant não exporta, consulta nem exclui pacientes de outro, e o link de exportação não vaza', async () => {
    const a = await tenant('iso-a');
    const b = await tenant('iso-b');
    await owner.patient.create({ data: { id: `p_${a.accountId}`, accountId: a.accountId, fullName: 'Paciente do A' } });
    await owner.patient.create({ data: { id: `p_${b.accountId}`, accountId: b.accountId, fullName: 'Paciente do B' } });
    const pa = `p_${a.accountId}`, pb = `p_${b.accountId}`;

    expect((await call(exportPatient, { cookie: a.cookie, params: { id: pb } })).status).toBe(404);
    expect((await call(deletionInfo, { method: 'GET', cookie: a.cookie, params: { id: pb } })).status).toBe(404);
    expect((await call(deletePatient, { cookie: a.cookie, params: { id: pb }, body: { mode: 'DELETE', confirm: true } })).status).toBe(404);
    expect(await owner.patient.count({ where: { id: pb } })).toBe(1);

    const exp = await call(exportPatient, { cookie: a.cookie, params: { id: pa } });
    expect(exp.status).toBe(201);
    const token = exp.json.downloadUrl.split('/').pop();
    const own = await call(download, { method: 'GET', cookie: a.cookie, params: { token } });
    expect(own.status).toBe(200);
    expect(own.headers.get('content-disposition')).toContain('attachment');
    expect(own.text).toContain('Paciente do A');
    expect((await call(download, { method: 'GET', cookie: b.cookie, params: { token } })).status).toBe(404);
  });

  it('alimento próprio é visível só ao tenant que o criou', async () => {
    const a = await tenant('food-a');
    const b = await tenant('food-b');
    const created = await call(createFood, { cookie: a.cookie, body: { name: 'Receita Secreta da A', per: '100g', values: { energyKcal: 100, proteinG: 5, carbG: 10, fatG: 4 } } });
    expect(created.status).toBe(201);
    const seenA = await call(searchFoods, { method: 'GET', cookie: a.cookie, url: 'http://localhost/api/foods/search?q=receita%20secreta' });
    const seenB = await call(searchFoods, { method: 'GET', cookie: b.cookie, url: 'http://localhost/api/foods/search?q=receita%20secreta' });
    expect(seenA.json.results).toHaveLength(1);
    expect(seenB.json.results).toHaveLength(0);
  });

  it('o checkout usa a conta da sessão e descarta um accountId enviado no corpo', async () => {
    const a = await tenant('chk-a');
    const b = await tenant('chk-b');
    const r = await call(checkout, { cookie: a.cookie, body: { planCode: 'clinico-30', method: 'PIX', accountId: b.accountId } });
    expect(r.status).toBe(200);
    const subA = await owner.subscription.findUniqueOrThrow({ where: { accountId: a.accountId } });
    const subB = await owner.subscription.findUniqueOrThrow({ where: { accountId: b.accountId } });
    expect(subA.pendingPlanId).not.toBeNull();
    expect(subB.pendingPlanId).toBeNull();
  });
});

describe('API · autorização por papel [seg]', () => {
  it('a secretária não acessa exportação, exclusão, alimentos nem cobrança; o titular continua com acesso', async () => {
    const t = await tenant('papel');
    await owner.patient.create({ data: { id: `p_${t.accountId}`, accountId: t.accountId, fullName: 'Paciente Papel' } });
    const id = `p_${t.accountId}`;
    await t.asRole('SECRETARIA');

    const forbidden = [
      await call(exportPatient, { cookie: t.cookie, params: { id } }),
      await call(deletePatient, { cookie: t.cookie, params: { id }, body: { mode: 'DELETE', confirm: true } }),
      await call(searchFoods, { method: 'GET', cookie: t.cookie, url: 'http://localhost/api/foods/search?q=arroz' }),
      await call(createFood, { cookie: t.cookie, body: { name: 'x', per: '100g', values: {} } }),
      await call(checkout, { cookie: t.cookie, body: { planCode: 'clinico-30', method: 'PIX' } }),
    ];
    expect(forbidden.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await owner.patient.count({ where: { id } })).toBe(1);

    await t.asRole('TITULAR');
    expect((await call(exportPatient, { cookie: t.cookie, params: { id } })).status).toBe(201);
  });

  it('exclusão exige confirmação explícita via API', async () => {
    const t = await tenant('conf');
    const id = `p_${t.accountId}`;
    await owner.patient.create({ data: { id, accountId: t.accountId, fullName: 'Para Excluir' } });
    const noConfirm = await call(deletePatient, { cookie: t.cookie, params: { id }, body: { mode: 'DELETE', confirm: false } });
    expect([noConfirm.status, noConfirm.json.error.code]).toEqual([422, 'confirmation_required']);
    expect(await owner.patient.count({ where: { id } })).toBe(1);
    expect((await call(deletePatient, { cookie: t.cookie, params: { id }, body: { mode: 'DELETE', confirm: true } })).status).toBe(200);
    expect(await owner.patient.count({ where: { id } })).toBe(0);
  });

  it('sessão de tenant não abre o painel do dono, e o inverso também não vale', async () => {
    const t = await tenant('cruzado');
    expect((await call(adminTenants, { method: 'GET', cookie: `sn_admin=${t.cookie.split('=')[1]}` })).status).toBe(401);
    expect((await call(adminTenants, { method: 'GET', cookie: t.cookie })).status).toBe(401);
    expect((await call(me, { method: 'GET', cookie: `sn_session=${t.cookie.split('=')[1]}x` })).status).toBe(401);
  });
});

describe('API · webhook do gateway [seg][api]', () => {
  const secret = process.env.GATEWAY_WEBHOOK_SECRET!;
  const send = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    return call(webhook, { raw, headers: { 'x-signature': sig ?? signBody(secret, raw) } });
  };

  it('assinatura inválida: 401 e nada muda', async () => {
    const t = await tenant('wh-a');
    const r = await send({ id: `evt_${Date.now()}_a`, type: 'PAYMENT_CONFIRMED', accountId: t.accountId }, 'assinatura-falsa');
    expect(r.status).toBe(401);
    expect((await owner.subscription.findUniqueOrThrow({ where: { accountId: t.accountId } })).status).toBe('TRIAL');
  });

  it('confirmação válida ativa a assinatura e a reentrega é idempotente', async () => {
    const t = await tenant('wh-b');
    await call(checkout, { cookie: t.cookie, body: { planCode: 'clinico-30', method: 'PIX' } });
    const evt = { id: `evt_${Date.now()}_b`, type: 'PAYMENT_CONFIRMED', accountId: t.accountId };
    expect((await send(evt)).json).toEqual({ ok: true, duplicate: false });
    expect((await send(evt)).json).toEqual({ ok: true, duplicate: true });
    expect((await owner.subscription.findUniqueOrThrow({ where: { accountId: t.accountId } })).status).toBe('ACTIVE');
    expect(await owner.invoice.count({ where: { accountId: t.accountId } })).toBe(1);
    expect((await call(me, { method: 'GET', cookie: t.cookie })).json.access.plan).toBe('clinico-30');
  });

  it('payload malformado com assinatura válida: 400', async () => {
    expect((await send({ foo: 'bar' })).status).toBe(400);
  });
});
