import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A } from '../../prisma/seed-data';
import { forTenant } from '../../src/db/tenant';
import { createAuthService, isUnverifiedEmailLoginEnabled, TERMS_VERSION } from '../../src/auth/service';
import { MemoryMailer } from '../../src/auth/mailer';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const mailer = new MemoryMailer();
let clock = Date.now();
const advance = (min: number) => (clock += min * 60_000);
const auth = createAuthService({ db, mailer, now: () => new Date(clock) });

const PASSWORD = 'Senha-Forte-123';
const valid = (email: string) => ({
  accountName: 'Consultório Teste', userName: 'Nutri Teste', email, password: PASSWORD,
  acceptTerms: true, acceptPrivacy: true, acceptDpa: true,
});
const tokenFrom = (to: string, kind: string) => {
  const mail = [...mailer.outbox].reverse().find((m) => m.to === to && m.kind === kind)!;
  return /token=([\w-]+)/.exec(mail.text)![1];
};
async function registerVerified(email: string) {
  await auth.signup(valid(email));
  await auth.confirmEmail(tokenFrom(email, 'verify_email'));
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect()]); });

describe('US-AUT-01 · criar conta e iniciar trial [api][seg]', () => {
  const email = 'nova@example.test';

  it('cria conta, unidade padrão, titular, assinatura de trial de 14 dias e aceites, sem cartão', async () => {
    expect(await auth.signup(valid(email))).toEqual({ ok: true });
    const user = await owner.user.findUniqueOrThrow({ where: { email } });
    const m = await owner.membership.findFirstOrThrow({ where: { userId: user.id }, include: { account: { include: { units: true, subscription: { include: { plan: true } } } } } });
    expect(m.role).toBe('TITULAR');
    expect(m.account.status).toBe('TRIAL');
    expect(m.account.units).toHaveLength(1);
    expect(m.account.subscription?.plan.code).toBe('trial');
    const days = (m.account.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    const terms = await owner.termsAcceptance.findMany({ where: { userId: user.id } });
    expect(terms.map((t) => t.kind).sort()).toEqual(['DPA', 'PRIVACY', 'TERMS']);
    expect(terms.every((t) => t.version === TERMS_VERSION)).toBe(true);
  });

  it('envia e-mail de confirmação e o token é de uso único', async () => {
    const token = tokenFrom(email, 'verify_email');
    expect(await auth.confirmEmail(token)).toBe(true);
    expect(await auth.confirmEmail(token)).toBe(false);
    expect((await owner.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();
  });

  it('e-mail já cadastrado: resposta neutra, sem segunda conta', async () => {
    const before = await owner.account.count();
    expect(await auth.signup(valid(email))).toEqual({ ok: true });
    expect(await owner.account.count()).toBe(before);
    expect(mailer.outbox.some((m) => m.to === email && m.kind === 'already_registered')).toBe(true);
  });

  it('senha fraca ou termos não aceitos: recusa e nada é gravado', async () => {
    const before = await owner.user.count();
    expect(await auth.signup({ ...valid('fraca@example.test'), password: 'curta1' })).toEqual({ ok: false, errors: ['password_weak'] });
    expect(await auth.signup({ ...valid('semtermo@example.test'), acceptDpa: false })).toEqual({ ok: false, errors: ['terms_required'] });
    expect(await owner.user.count()).toBe(before);
  });

  it('sem confirmar o e-mail, o login não entrega sessão', async () => {
    await auth.signup(valid('naoconfirmou@example.test'));
    expect(await auth.login('naoconfirmou@example.test', PASSWORD)).toEqual({ ok: false, reason: 'email_not_verified' });
  });

  it('só permite pular confirmação em desenvolvimento, nunca em produção', () => {
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'development', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' })).toBe(true);
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'production', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' })).toBe(false);
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'test', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' })).toBe(false);
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'development', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'false' })).toBe(false);
  });

  it('creates a session for an unverified account only while the development bypass is enabled', async () => {
    const email = 'bypass-verificacao@example.test';
    const developmentAuth = createAuthService({
      db,
      mailer,
      now: () => new Date(clock),
      environment: { NODE_ENV: 'development', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' },
    });
    await developmentAuth.signup(valid(email));
    const result = await developmentAuth.login(email, PASSWORD);
    expect(result.ok).toBe(true);
  });
});

describe('US-AUT-02 · login e sessão [e2e][seg]', () => {
  it('login correto acessa apenas dados do próprio tenant', async () => {
    const email = 'login@example.test';
    await registerVerified(email);
    const r = await auth.login(email, PASSWORD);
    if (!r.ok) throw new Error('login falhou');
    expect(r.role).toBe('TITULAR');
    expect(await forTenant(r.accountId, undefined, db).patient.findMany()).toHaveLength(0);
    expect(await forTenant(r.accountId, undefined, db).account.findUnique({ where: { id: TENANT_A } })).toBeNull();
  });

  it('senha errada e e-mail inexistente devolvem exatamente o mesmo erro', async () => {
    await registerVerified('existe@example.test');
    const wrong = await auth.login('existe@example.test', 'Errada-12345');
    const unknown = await auth.login('naoexiste@example.test', 'Errada-12345');
    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('5 falhas bloqueiam a conta (mesmo com a senha certa), avisam por e-mail e liberam após o prazo', async () => {
    const email = 'bloqueio@example.test';
    await registerVerified(email);
    for (let i = 0; i < 5; i++) await auth.login(email, 'Errada-12345');
    expect(mailer.outbox.some((m) => m.to === email && m.kind === 'account_locked')).toBe(true);
    expect(await auth.login(email, PASSWORD)).toEqual({ ok: false, reason: 'invalid_credentials' });
    advance(16);
    expect((await auth.login(email, PASSWORD)).ok).toBe(true);
  });

  it('logout invalida a sessão imediatamente', async () => {
    const email = 'logout@example.test';
    await registerVerified(email);
    const r = await auth.login(email, PASSWORD);
    if (!r.ok) throw new Error('login falhou');
    expect(await auth.validateSession(r.token)).not.toBeNull();
    await auth.logout(r.token);
    expect(await auth.validateSession(r.token)).toBeNull();
  });

  it('sessão expira por inatividade; atividade renova o prazo (relógio simulado)', async () => {
    const email = 'idle@example.test';
    await registerVerified(email);
    const r = await auth.login(email, PASSWORD);
    if (!r.ok) throw new Error('login falhou');
    advance(29);
    expect(await auth.validateSession(r.token)).not.toBeNull(); // renova
    advance(29);
    expect(await auth.validateSession(r.token)).not.toBeNull(); // renova de novo
    advance(31);
    expect(await auth.validateSession(r.token)).toBeNull();
  });

  it('o token da sessão não é guardado em texto aberto', async () => {
    const email = 'hash@example.test';
    await registerVerified(email);
    const r = await auth.login(email, PASSWORD);
    if (!r.ok) throw new Error('login falhou');
    expect(await owner.session.count({ where: { tokenHash: r.token } })).toBe(0);
  });
});
