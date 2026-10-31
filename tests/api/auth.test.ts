import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { totpCode } from '../../src/auth/totp';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as mfa } from '@/app/api/auth/mfa/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { POST as forgot } from '@/app/api/auth/password/forgot/route';
import { POST as reset } from '@/app/api/auth/password/reset/route';
import { GET as me } from '@/app/api/me/route';
import { POST as setup2fa } from '@/app/api/2fa/setup/route';
import { POST as confirm2fa } from '@/app/api/2fa/confirm/route';
import { POST as invite } from '@/app/api/team/invite/route';
import { call, cookieOf, tokenFrom, randomIp } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const signupBody = (email: string, extra: object = {}) => ({
  accountName: 'Clínica API', userName: 'Nutri API', email, password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true, ...extra,
});

async function registerVerified(email: string) {
  await call(signup, { body: signupBody(email) });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
}
async function sessionFor(email: string) {
  const r = await call(login, { body: { email, password: PASSWORD } });
  return cookieOf(r, 'sn_session');
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API · cadastro e confirmação [e2e]', () => {
  it('cadastra com resposta neutra para e-mail repetido e recusa dados inválidos', async () => {
    const email = uniq('novo');
    expect((await call(signup, { body: signupBody(email) })).status).toBe(202);
    const dup = await call(signup, { body: signupBody(email) });
    expect(dup.status).toBe(202);
    expect(dup.json).toEqual({ ok: true });
    const weak = await call(signup, { body: signupBody(uniq('fraca'), { password: 'curta1' }) });
    expect(weak.status).toBe(422);
    expect(weak.json.error.errors).toEqual(['password_weak']);
    expect((await call(signup, { body: { email: 'x' } })).status).toBe(400);
  });

  it('sem confirmar o e-mail o login é negado; depois de confirmar, entra com cookie seguro', async () => {
    const email = uniq('conf');
    await call(signup, { body: signupBody(email) });
    const before = await call(login, { body: { email, password: PASSWORD } });
    expect(before.status).toBe(403);
    expect(before.json.error.code).toBe('email_not_verified');

    await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
    const ok = await call(login, { body: { email, password: PASSWORD } });
    expect(ok.status).toBe(200);
    expect(ok.json.role).toBe('TITULAR');
    const sc = ok.setCookies.find((c) => c.startsWith('sn_session='))!;
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.text).not.toContain(cookieOf(ok, 'sn_session').split('=')[1]); // o token não vai no corpo
  });
});

describe('API · sessão e erros genéricos [seg]', () => {
  it('/me exige sessão, devolve papel e estado de acesso, e o logout encerra na hora', async () => {
    const email = uniq('me');
    await registerVerified(email);
    expect((await call(me, { method: 'GET' })).status).toBe(401);

    const cookie = await sessionFor(email);
    const r = await call(me, { method: 'GET', cookie });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ role: 'TITULAR', access: { mode: 'FULL', plan: 'trial' } });

    const out = await call(logout, { cookie });
    expect(out.setCookies[0]).toContain('Max-Age=0');
    expect((await call(me, { method: 'GET', cookie })).status).toBe(401);
  });

  it('senha errada e e-mail inexistente devolvem exatamente a mesma resposta', async () => {
    const email = uniq('gen');
    await registerVerified(email);
    const wrong = await call(login, { body: { email, password: 'Errada-12345' } });
    const unknown = await call(login, { body: { email: uniq('fantasma'), password: 'Errada-12345' } });
    expect([wrong.status, wrong.text]).toEqual([unknown.status, unknown.text]);
    expect(wrong.status).toBe(401);
  });

  it('cookie forjado ou vazio não autentica', async () => {
    expect((await call(me, { method: 'GET', cookie: 'sn_session=forjado' })).status).toBe(401);
    expect((await call(me, { method: 'GET', cookie: 'sn_session=' })).status).toBe(401);
  });

  it('CSRF: corpo que não é JSON ou origem estranha é recusado antes de qualquer lógica', async () => {
    const r1 = await call(login, { headers: { 'content-type': 'text/plain' }, raw: 'email=a&password=b' });
    expect([r1.status, r1.json.error.code]).toEqual([403, 'csrf']);
    const r2 = await call(login, { headers: { origin: 'https://evil.test', host: 'localhost' }, body: { email: 'a@b.co', password: 'x' } });
    expect([r2.status, r2.json.error.code]).toEqual([403, 'csrf']);
  });

  it('corpo inválido: 400 sem vazar detalhes internos', async () => {
    const bad = await call(login, { raw: '{' });
    expect([bad.status, bad.json.error.code]).toEqual([400, 'invalid_json']);
    const v = await call(login, { body: { email: 'nao-e-email', password: '' } });
    expect([v.status, v.json.error.code]).toEqual([400, 'validation']);
  });

  it('limite de requisições: a 11ª tentativa de login do mesmo IP recebe 429 com Retry-After', async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) expect((await call(login, { ip, body: { email: 'x@example.test', password: 'Errada-12345' } })).status).toBe(401);
    const blocked = await call(login, { ip, body: { email: 'x@example.test', password: 'Errada-12345' } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call(login, { ip: randomIp(), body: { email: 'x@example.test', password: 'Errada-12345' } })).status).toBe(401);
  });

  it('recuperar senha: resposta igual exista ou não a conta, e a nova senha vale', async () => {
    const email = uniq('rec');
    await registerVerified(email);
    const a = await call(forgot, { body: { email } });
    const b = await call(forgot, { body: { email: uniq('fantasma') } });
    expect([a.status, a.text]).toEqual([b.status, b.text]);

    const r = await call(reset, { body: { token: tokenFrom(email, 'password_reset'), password: 'Outra-Senha-456' } });
    expect(r.status).toBe(200);
    expect((await call(login, { body: { email, password: PASSWORD } })).status).toBe(401);
    expect((await call(login, { body: { email, password: 'Outra-Senha-456' } })).status).toBe(200);
  });
});

describe('API · 2FA ponta a ponta [e2e][seg]', () => {
  it('ativa o 2FA, e o login passa a exigir o segundo passo; a senha sozinha não dá sessão', async () => {
    const email = uniq('mfa');
    await registerVerified(email);
    const cookie = await sessionFor(email);

    const s = await call(setup2fa, { cookie });
    expect(s.status).toBe(200);
    const c = await call(confirm2fa, { cookie, body: { code: '000000' } });
    expect(c.status).toBe(400);
    const ok = await call(confirm2fa, { cookie, body: { code: totpCode(s.json.secret, Date.now()) } });
    expect(ok.status).toBe(200);
    expect(ok.json.recoveryCodes).toHaveLength(10);
    expect((await call(setup2fa, { cookie })).status).toBe(409);

    await call(logout, { cookie });
    const step1 = await call(login, { body: { email, password: PASSWORD } });
    expect(step1.json.mfa_required).toBe(true);
    expect(cookieOf(step1, 'sn_session')).toBe(''); // sem cookie de sessão ainda

    const wrong = await call(mfa, { body: { challenge: step1.json.challenge, code: '000000' } });
    expect(wrong.status).toBe(401);
    // o passo atual já foi usado na ativação: o próximo (dentro da janela) é aceito uma vez só
    const nextCode = totpCode(s.json.secret, Date.now() + 30_000);
    const done = await call(mfa, { body: { challenge: step1.json.challenge, code: nextCode } });
    expect(done.status).toBe(200);
    const session = cookieOf(done, 'sn_session');
    expect((await call(me, { method: 'GET', cookie: session })).status).toBe(200);

    const again = await call(login, { body: { email, password: PASSWORD } });
    expect((await call(mfa, { body: { challenge: again.json.challenge, code: nextCode } })).status).toBe(401); // código reutilizado
  });
});

describe('API · papel mudou, vale na próxima requisição [seg]', () => {
  it('rebaixar o titular para secretária bloqueia a gestão de equipe sem novo login', async () => {
    const email = uniq('papel');
    await registerVerified(email);
    const cookie = await sessionFor(email);
    const before = await call(invite, { cookie, body: { email: uniq('colega'), role: 'PROFISSIONAL' } });
    expect(before.status).not.toBe(403);

    const u = await owner.user.findUniqueOrThrow({ where: { email } });
    await owner.membership.updateMany({ where: { userId: u.id }, data: { role: 'SECRETARIA' } });
    const after = await call(invite, { cookie, body: { email: uniq('colega'), role: 'PROFISSIONAL' } });
    expect([after.status, after.json.error.code]).toEqual([403, 'forbidden']);
  });
});
