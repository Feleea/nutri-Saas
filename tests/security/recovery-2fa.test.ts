import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { createAuthService } from '../../src/auth/service';
import { createAdminAuthService } from '../../src/auth/admin';
import { MemoryMailer } from '../../src/auth/mailer';
import { hashPassword } from '../../src/auth/password';
import { encryptSecret } from '../../src/crypto/secrets';
import { generateSecret, totpCode } from '../../src/auth/totp';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
const mailer = new MemoryMailer();
let clock = Date.now();
const advance = (min: number) => (clock += min * 60_000);
const now = () => new Date(clock);
const auth = createAuthService({ db, mailer, now });
const adminAuth = createAdminAuthService({ db: adminDb, now });

const PASSWORD = 'Senha-Forte-123';
const NEW_PASSWORD = 'Outra-Senha-456';
const valid = (email: string) => ({
  accountName: 'Consultório Teste', userName: 'Nutri Teste', email, password: PASSWORD,
  acceptTerms: true, acceptPrivacy: true, acceptDpa: true,
});
const lastToken = (to: string, kind: string) => {
  const mail = [...mailer.outbox].reverse().find((m) => m.to === to && m.kind === kind)!;
  return /token=([\w-]+)/.exec(mail.text)![1];
};
const mails = (to: string, kind: string) => mailer.outbox.filter((m) => m.to === to && m.kind === kind);

async function registerVerified(email: string) {
  await auth.signup(valid(email));
  await auth.confirmEmail(lastToken(email, 'verify_email'));
  return (await owner.user.findUniqueOrThrow({ where: { email } })).id;
}

/** Usuário com 2FA ativo. Avança 1 min para que os próximos códigos usem passos novos. */
async function userWith2fa(email: string) {
  const userId = await registerVerified(email);
  const { secret } = await auth.beginTotpSetup(userId);
  const codes = (await auth.confirmTotpSetup(userId, totpCode(secret, clock)))!;
  advance(1);
  return { userId, secret, codes };
}
const wrongCode = (secret: string) => totpCode(secret, clock + 10 * 3_600_000);

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect(), adminDb.$disconnect()]); });

describe('US-AUT-03 · recuperar senha [seg][api]', () => {
  it('resposta idêntica para e-mail existente e inexistente; só o existente recebe e-mail', async () => {
    await registerVerified('rec1@example.test');
    const a = await auth.requestPasswordReset('rec1@example.test');
    const b = await auth.requestPasswordReset('fantasma@example.test');
    expect(a).toEqual(b);
    expect(mails('rec1@example.test', 'password_reset')).toHaveLength(1);
    expect(mails('fantasma@example.test', 'password_reset')).toHaveLength(0);
  });

  it('o link é de uso único e expira em 1 hora (relógio simulado)', async () => {
    const email = 'rec2@example.test';
    await registerVerified(email);
    await auth.requestPasswordReset(email);
    const token = lastToken(email, 'password_reset');
    expect(await auth.resetPassword(token, NEW_PASSWORD)).toEqual({ ok: true });
    expect(await auth.resetPassword(token, 'Terceira-Senha-789')).toEqual({ ok: false, reason: 'invalid_token' });

    await auth.requestPasswordReset(email);
    const expired = lastToken(email, 'password_reset');
    advance(61);
    expect(await auth.resetPassword(expired, NEW_PASSWORD)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('nova senha vale, a antiga não, sessões anteriores caem e o titular é avisado', async () => {
    const email = 'rec3@example.test';
    await registerVerified(email);
    const s = await auth.login(email, PASSWORD);
    if (!s.ok) throw new Error('login falhou');
    await auth.requestPasswordReset(email);
    expect(await auth.resetPassword(lastToken(email, 'password_reset'), NEW_PASSWORD)).toEqual({ ok: true });

    expect(await auth.validateSession(s.token)).toBeNull();
    expect((await auth.login(email, PASSWORD)).ok).toBe(false);
    expect((await auth.login(email, NEW_PASSWORD)).ok).toBe(true);
    expect(mails(email, 'password_changed')).toHaveLength(1);
  });

  it('senha fraca é recusada sem consumir o link', async () => {
    const email = 'rec4@example.test';
    await registerVerified(email);
    await auth.requestPasswordReset(email);
    const token = lastToken(email, 'password_reset');
    expect(await auth.resetPassword(token, 'fraca')).toEqual({ ok: false, reason: 'password_weak' });
    expect(await auth.resetPassword(token, NEW_PASSWORD)).toEqual({ ok: true });
  });

  it('um novo pedido invalida o link anterior', async () => {
    const email = 'rec5@example.test';
    await registerVerified(email);
    await auth.requestPasswordReset(email);
    const first = lastToken(email, 'password_reset');
    await auth.requestPasswordReset(email);
    expect(await auth.resetPassword(first, NEW_PASSWORD)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('o token de redefinição não serve para confirmar e-mail', async () => {
    const email = 'rec6@example.test';
    await registerVerified(email);
    await auth.requestPasswordReset(email);
    expect(await auth.confirmEmail(lastToken(email, 'password_reset'))).toBe(false);
  });

  it('a redefinição desbloqueia uma conta bloqueada', async () => {
    const email = 'rec7@example.test';
    await registerVerified(email);
    for (let i = 0; i < 5; i++) await auth.login(email, 'Errada-12345');
    await auth.requestPasswordReset(email);
    await auth.resetPassword(lastToken(email, 'password_reset'), NEW_PASSWORD);
    expect((await auth.login(email, NEW_PASSWORD)).ok).toBe(true);
  });
});

describe('US-AUT-04 · 2FA por aplicativo autenticador [e2e][seg]', () => {
  it('ativar exige confirmar um código válido; entrega 10 códigos de recuperação', async () => {
    const userId = await registerVerified('mfa1@example.test');
    const { secret, otpauthUri } = await auth.beginTotpSetup(userId);
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(await auth.confirmTotpSetup(userId, wrongCode(secret))).toBeNull();
    expect((await owner.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).toBeNull();

    const codes = await auth.confirmTotpSetup(userId, totpCode(secret, clock));
    expect(codes).toHaveLength(10);
    expect((await owner.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).not.toBeNull();
  });

  it('segredo e códigos de recuperação não ficam em texto aberto no banco', async () => {
    const { userId, secret, codes } = await userWith2fa('mfa2@example.test');
    const u = await owner.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.totpSecret).not.toContain(secret);
    const stored = (await owner.recoveryCode.findMany({ where: { userId } })).map((r) => r.codeHash);
    expect(stored).toHaveLength(10);
    expect(stored.some((h) => codes.some((c) => h.includes(c.replace('-', ''))))).toBe(false);
  });

  it('com 2FA, a senha sozinha não cria sessão; senha + código cria', async () => {
    const email = 'mfa3@example.test';
    const { userId, secret } = await userWith2fa(email);
    const before = await owner.session.count({ where: { userId } });

    const step1 = await auth.login(email, PASSWORD);
    if (step1.ok || step1.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    expect(await owner.session.count({ where: { userId } })).toBe(before);
    expect((await auth.verifyMfa(step1.challenge, wrongCode(secret))).ok).toBe(false);
    expect(await owner.session.count({ where: { userId } })).toBe(before);

    const ok = await auth.verifyMfa(step1.challenge, totpCode(secret, clock));
    expect(ok.ok).toBe(true);
    expect(await owner.session.count({ where: { userId } })).toBe(before + 1);
  });

  it('código já usado é negado; um código novo funciona', async () => {
    const email = 'mfa4@example.test';
    const { secret } = await userWith2fa(email);
    const code = totpCode(secret, clock);

    const c1 = await auth.login(email, PASSWORD);
    if (c1.ok || c1.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    expect((await auth.verifyMfa(c1.challenge, code)).ok).toBe(true);

    const c2 = await auth.login(email, PASSWORD);
    if (c2.ok || c2.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    expect((await auth.verifyMfa(c2.challenge, code)).ok).toBe(false);
    advance(1);
    expect((await auth.verifyMfa(c2.challenge, totpCode(secret, clock))).ok).toBe(true);
  });

  it('desafio de 2FA é de uso único e expira em 5 minutos', async () => {
    const email = 'mfa5@example.test';
    const { secret } = await userWith2fa(email);
    const c = await auth.login(email, PASSWORD);
    if (c.ok || c.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    advance(6);
    expect((await auth.verifyMfa(c.challenge, totpCode(secret, clock))).ok).toBe(false);
  });

  it('código de recuperação funciona uma única vez', async () => {
    const email = 'mfa6@example.test';
    const { codes } = await userWith2fa(email);
    const c1 = await auth.login(email, PASSWORD);
    if (c1.ok || c1.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    expect((await auth.verifyMfa(c1.challenge, codes[0])).ok).toBe(true);

    const c2 = await auth.login(email, PASSWORD);
    if (c2.ok || c2.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    expect((await auth.verifyMfa(c2.challenge, codes[0])).ok).toBe(false);
  });

  it('5 códigos errados bloqueiam a conta e avisam por e-mail', async () => {
    const email = 'mfa7@example.test';
    const { secret } = await userWith2fa(email);
    const c = await auth.login(email, PASSWORD);
    if (c.ok || c.reason !== 'mfa_required') throw new Error('esperava mfa_required');
    for (let i = 0; i < 5; i++) await auth.verifyMfa(c.challenge, wrongCode(secret));
    expect(mails(email, 'account_locked')).toHaveLength(1);
    expect((await auth.verifyMfa(c.challenge, totpCode(secret, clock))).ok).toBe(false);
  });

  it('tentar ativar de novo com 2FA já ativo é recusado', async () => {
    const { userId } = await userWith2fa('mfa8@example.test');
    await expect(auth.beginTotpSetup(userId)).rejects.toThrow();
  });
});

describe('US-AUT-04 · super-admin: 2FA obrigatório [seg]', () => {
  const email = 'dono@example.test';
  let secret: string;

  beforeAll(async () => {
    secret = generateSecret();
    await owner.platformAdmin.create({
      data: { id: 'adm_1', email, passwordHash: await hashPassword('Admin-Senha-123'), totpSecret: encryptSecret(secret) },
    });
  });

  it('senha sem código é recusada', async () => {
    expect((await adminAuth.login(email, 'Admin-Senha-123', '')).ok).toBe(false);
  });

  it('código correto com senha errada é recusado', async () => {
    expect((await adminAuth.login(email, 'errada', totpCode(secret, clock))).ok).toBe(false);
  });

  it('senha + código válidos entram; o código não pode ser reutilizado', async () => {
    advance(1);
    const code = totpCode(secret, clock);
    const r = await adminAuth.login(email, 'Admin-Senha-123', code);
    expect(r.ok).toBe(true);
    expect((await adminAuth.login(email, 'Admin-Senha-123', code)).ok).toBe(false);
    expect(await owner.adminAuditLog.count({ where: { adminId: 'adm_1', action: 'ADMIN_LOGIN' } })).toBe(1);
  });

  it('sessão do painel expira em 15 minutos de inatividade e cai no logout', async () => {
    advance(1);
    const r = await adminAuth.login(email, 'Admin-Senha-123', totpCode(secret, clock));
    if (!r.ok) throw new Error('login do admin falhou');
    advance(14);
    expect(await adminAuth.validateSession(r.token)).not.toBeNull();
    advance(16);
    expect(await adminAuth.validateSession(r.token)).toBeNull();

    advance(1);
    const r2 = await adminAuth.login(email, 'Admin-Senha-123', totpCode(secret, clock));
    if (!r2.ok) throw new Error('login do admin falhou');
    await adminAuth.logout(r2.token);
    expect(await adminAuth.validateSession(r2.token)).toBeNull();
  });

  it('5 tentativas falhas bloqueiam o painel', async () => {
    advance(1);
    for (let i = 0; i < 5; i++) await adminAuth.login(email, 'errada', '000000');
    expect((await adminAuth.login(email, 'Admin-Senha-123', totpCode(secret, clock))).ok).toBe(false);
    advance(16);
    expect((await adminAuth.login(email, 'Admin-Senha-123', totpCode(secret, clock))).ok).toBe(true);
  });

  it('o admin não consegue ler tabelas de usuário, sessão ou códigos (sem GRANT)', async () => {
    for (const t of ['User', 'Session', 'EmailToken', 'RecoveryCode']) {
      await expect(adminDb.$queryRawUnsafe(`SELECT 1 FROM "${t}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    }
  });
});
