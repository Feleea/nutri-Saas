import { PrismaClient } from '@prisma/client';
import { forTenant } from '../db/tenant';
import { hashPassword, verifyPassword, validatePassword, newToken, hashToken } from './password';
import { encryptSecret, decryptSecret } from '../crypto/secrets';
import { generateSecret, otpauthUri, verifyTotp, generateRecoveryCodes, normalizeRecoveryCode } from './totp';
import type { Mailer } from './mailer';
import { appUrl } from './links';

export const TERMS_VERSION = '2026-10-v1';

export const AUTH_CONFIG = {
  trialDays: 14,
  maxFailedLogins: 5,
  lockMinutes: 15,
  sessionIdleMinutes: 30,
  verifyTokenHours: 48,
  resetTokenMinutes: 60,
  mfaChallengeMinutes: 5,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN = 60_000;

export interface SignupInput {
  accountName: string;
  userName: string;
  email: string;
  password: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptDpa: boolean;
}

export type SignupResult = { ok: true } | { ok: false; errors: string[] };
export type LoginResult =
  | { ok: true; token: string; accountId: string; role: string }
  | { ok: false; reason: 'invalid_credentials' | 'email_not_verified' }
  | { ok: false; reason: 'mfa_required'; challenge: string };
export type ResetResult = { ok: true } | { ok: false; reason: 'invalid_token' | 'password_weak' };
export interface SessionInfo {
  userId: string;
  accountId: string;
  role: string;
}

interface Deps {
  db: PrismaClient; // conectado como suasnutri_app
  mailer: Mailer;
  now?: () => Date; // relógio injetável: testa prazos sem esperar
  config?: typeof AUTH_CONFIG;
}

export function createAuthService({ db, mailer, now = () => new Date(), config = AUTH_CONFIG }: Deps) {
  let dummyHash: Promise<string> | undefined;
  const INVALID = { ok: false, reason: 'invalid_credentials' } as const;
  const after = (minutes: number) => new Date(now().getTime() + minutes * MIN);

  async function issueToken(userId: string, kind: 'VERIFY' | 'RESET' | 'MFA', minutes: number) {
    const { token, hash } = newToken();
    await db.emailToken.create({ data: { userId, kind, tokenHash: hash, expiresAt: after(minutes) } });
    return token;
  }

  async function issueVerifyToken(userId: string, email: string) {
    const token = await issueToken(userId, 'VERIFY', config.verifyTokenHours * 60);
    await mailer.send({
      to: email,
      kind: 'verify_email',
      subject: 'Confirme seu e-mail no Suas Nutri',
      text: `Confirme seu cadastro: ${appUrl('/verificar-email')}?token=${token}`,
    });
  }

  /** Usuário + titulares das contas dele (sem duplicar endereços). */
  async function noticeRecipients(userId: string, email: string): Promise<string[]> {
    const rows = await db.$queryRaw<{ email: string }[]>`SELECT email FROM auth_titular_emails(${userId})`;
    return [...new Set([email, ...rows.map((r) => r.email)])];
  }

  /** Conta a falha e bloqueia ao atingir o limite; avisa usuário e titular. */
  async function registerFailure(user: { id: string; email: string }) {
    const updated = await db.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
    if (updated.failedLogins < config.maxFailedLogins) return;
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: after(config.lockMinutes) } });
    for (const to of await noticeRecipients(user.id, user.email)) {
      await mailer.send({
        to,
        kind: 'account_locked',
        subject: 'Acesso temporariamente bloqueado',
        text: `Houve ${config.maxFailedLogins} tentativas de acesso sem sucesso para ${user.email}. Bloqueio de ${config.lockMinutes} minutos.`,
      });
    }
  }

  async function startSession(userId: string): Promise<LoginResult> {
    const [m] = await db.$queryRaw<{ account_id: string; role: string }[]>`
      SELECT account_id, role FROM auth_memberships(${userId})`;
    if (!m) return INVALID;
    const { token, hash } = newToken();
    await db.session.create({
      data: { tokenHash: hash, userId, accountId: m.account_id, createdAt: now(), lastSeenAt: now() },
    });
    const tenant = forTenant(m.account_id, userId, db);
    await tenant.account.update({ where: { id: m.account_id }, data: { lastAccessAt: now() } });
    await tenant.auditLog.create({
      data: { accountId: m.account_id, actorUserId: userId, action: 'LOGIN', resource: 'session' },
    });
    return { ok: true, token, accountId: m.account_id, role: m.role };
  }

  // ───────────── Cadastro (US-AUT-01) ─────────────
  async function signup(input: SignupInput): Promise<SignupResult> {
    const email = input.email.trim().toLowerCase();
    const errors: string[] = [];
    if (!EMAIL_RE.test(email)) errors.push('email_invalid');
    if (!validatePassword(input.password)) errors.push('password_weak');
    if (!input.accountName.trim() || !input.userName.trim()) errors.push('name_required');
    if (!(input.acceptTerms && input.acceptPrivacy && input.acceptDpa)) errors.push('terms_required');
    if (errors.length) return { ok: false, errors };

    const passwordHash = await hashPassword(input.password);
    const rows = await db.$queryRaw<{ account_id: string; user_id: string }[]>`
      SELECT * FROM signup_create_tenant(${input.accountName.trim()}, ${email}, ${input.userName.trim()},
        ${passwordHash}, 'trial', ${TERMS_VERSION}, ${config.trialDays}::int)`;

    if (rows.length === 0) {
      await mailer.send({
        to: email,
        kind: 'already_registered',
        subject: 'Você já tem conta no Suas Nutri',
        text: 'Já existe uma conta com este e-mail. Se foi você, use "Esqueci minha senha".',
      });
    } else {
      await issueVerifyToken(rows[0].user_id, email);
    }
    return { ok: true };
  }

  async function confirmEmail(token: string): Promise<boolean> {
    const row = await db.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.kind !== 'VERIFY' || row.usedAt || row.expiresAt <= now()) return false;
    await db.$transaction([
      db.emailToken.update({ where: { id: row.id }, data: { usedAt: now() } }),
      db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now() } }),
    ]);
    return true;
  }

  async function resendVerification(emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) await issueVerifyToken(user.id, email);
  }

  // ───────────── Login e sessão (US-AUT-02 / US-AUT-04) ─────────────
  async function login(emailRaw: string, password: string): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email } });

    if (!user) {
      dummyHash ??= hashPassword('dummy-password-0');
      await verifyPassword(password, await dummyHash); // iguala o tempo de resposta
      return INVALID;
    }
    if (user.lockedUntil && user.lockedUntil > now()) return INVALID;
    if (!(await verifyPassword(password, user.passwordHash))) {
      await registerFailure(user);
      return INVALID;
    }
    if (user.failedLogins || user.lockedUntil) {
      await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    if (!user.emailVerifiedAt) return { ok: false, reason: 'email_not_verified' };

    // Com 2FA ativo, a senha sozinha NÃO cria sessão: devolve um desafio de curta duração.
    if (user.totpEnabledAt) {
      const challenge = await issueToken(user.id, 'MFA', config.mfaChallengeMinutes);
      return { ok: false, reason: 'mfa_required', challenge };
    }
    return startSession(user.id);
  }

  /** Segundo passo: código do app autenticador OU código de recuperação (uso único). */
  async function verifyMfa(challenge: string, code: string): Promise<LoginResult> {
    const row = await db.emailToken.findUnique({ where: { tokenHash: hashToken(challenge) } });
    if (!row || row.kind !== 'MFA' || row.usedAt || row.expiresAt <= now()) return INVALID;
    const user = await db.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.totpSecret || !user.totpEnabledAt) return INVALID;
    if (user.lockedUntil && user.lockedUntil > now()) return INVALID;

    let ok = false;
    const step = verifyTotp(decryptSecret(user.totpSecret), code.trim(), now().getTime(), user.totpLastStep);
    if (step !== null) {
      // atualização condicional: duas tentativas simultâneas com o mesmo código não passam juntas
      const upd = await db.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      ok = upd.count === 1;
    } else {
      const used = await db.recoveryCode.updateMany({
        where: { userId: user.id, codeHash: hashToken(normalizeRecoveryCode(code)), usedAt: null },
        data: { usedAt: now() },
      });
      ok = used.count === 1;
    }

    if (!ok) {
      await registerFailure(user); // 2FA também conta para o bloqueio (evita força bruta)
      return INVALID;
    }
    await db.emailToken.update({ where: { id: row.id }, data: { usedAt: now() } });
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0 } });
    return startSession(user.id);
  }

  async function validateSession(token: string): Promise<SessionInfo | null> {
    const s = await db.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!s || s.revokedAt) return null;
    if (s.lastSeenAt.getTime() + config.sessionIdleMinutes * MIN <= now().getTime()) return null;
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: now() } });
    const rows = await db.$queryRaw<{ account_id: string; role: string }[]>`
      SELECT account_id, role FROM auth_memberships(${s.userId})`;
    const m = rows.find((r) => r.account_id === s.accountId);
    return m ? { userId: s.userId, accountId: s.accountId, role: m.role } : null;
  }

  async function logout(token: string): Promise<void> {
    await db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now() } });
  }

  // ───────────── Recuperar senha (US-AUT-03) ─────────────
  /** Resposta idêntica exista ou não a conta. */
  async function requestPasswordReset(emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email } });
    if (!user) return;
    // um único link válido por vez
    await db.emailToken.updateMany({ where: { userId: user.id, kind: 'RESET', usedAt: null }, data: { usedAt: now() } });
    const token = await issueToken(user.id, 'RESET', config.resetTokenMinutes);
    await mailer.send({
      to: email,
      kind: 'password_reset',
      subject: 'Redefinição de senha',
      text: `Redefina sua senha (válido por ${config.resetTokenMinutes} minutos): ${appUrl('/redefinir-senha')}?token=${token}`,
    });
  }

  async function resetPassword(token: string, newPassword: string): Promise<ResetResult> {
    const row = await db.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.kind !== 'RESET' || row.usedAt || row.expiresAt <= now()) return { ok: false, reason: 'invalid_token' };
    if (!validatePassword(newPassword)) return { ok: false, reason: 'password_weak' }; // não consome o token

    const passwordHash = await hashPassword(newPassword);
    const [, user] = await db.$transaction([
      db.emailToken.update({ where: { id: row.id }, data: { usedAt: now() } }),
      db.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
      db.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now() } }),
    ]);
    for (const to of await noticeRecipients(user.id, user.email)) {
      await mailer.send({
        to,
        kind: 'password_changed',
        subject: 'Senha alterada',
        text: `A senha de ${user.email} foi alterada e todas as sessões foram encerradas. Se não foi você, contate o suporte.`,
      });
    }
    return { ok: true };
  }

  // ───────────── Configurar 2FA (US-AUT-04) ─────────────
  async function beginTotpSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new Error('2FA já está ativo');
    const secret = generateSecret();
    await db.user.update({ where: { id: userId }, data: { totpSecret: encryptSecret(secret) } });
    return { secret, otpauthUri: otpauthUri(user.email, secret) };
  }

  /** Confirma o primeiro código, ativa o 2FA e devolve os códigos de recuperação (única exibição). */
  async function confirmTotpSetup(userId: string, code: string): Promise<string[] | null> {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecret || user.totpEnabledAt) return null;
    const step = verifyTotp(decryptSecret(user.totpSecret), code.trim(), now().getTime(), user.totpLastStep);
    if (step === null) return null;
    const codes = generateRecoveryCodes(10);
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { totpEnabledAt: now(), totpLastStep: step } }),
      db.recoveryCode.deleteMany({ where: { userId } }),
      db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashToken(normalizeRecoveryCode(c)) })) }),
    ]);
    return codes;
  }

  async function disableTotp(userId: string, password: string, code: string): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabledAt || !(await verifyPassword(password, user.passwordHash))) return false;

    const step = verifyTotp(decryptSecret(user.totpSecret), code.trim(), now().getTime(), user.totpLastStep);
    if (step === null) return false;

    return db.$transaction(async (tx) => {
      const disabled = await tx.user.updateMany({
        where: {
          id: userId,
          totpSecret: user.totpSecret,
          totpEnabledAt: { not: null },
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
      });
      if (disabled.count !== 1) return false;
      await tx.recoveryCode.deleteMany({ where: { userId } });
      return true;
    });
  }

  return {
    signup, confirmEmail, resendVerification,
    login, verifyMfa, validateSession, logout,
    requestPasswordReset, resetPassword,
    beginTotpSetup, confirmTotpSetup, disableTotp,
  };
}
