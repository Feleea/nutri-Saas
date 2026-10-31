import { PrismaClient } from '@prisma/client';
import { verifyPassword, hashPassword, newToken, hashToken } from './password';
import { decryptSecret } from '../crypto/secrets';
import { verifyTotp } from './totp';
import { auditOrigin } from './audit';

export const ADMIN_AUTH_CONFIG = { maxFailedLogins: 5, lockMinutes: 15, sessionIdleMinutes: 15 };
const MIN = 60_000;

export type AdminLoginResult = { ok: true; token: string } | { ok: false; reason: 'invalid_credentials' };

interface Deps {
  db: PrismaClient; // conectado como suasnutri_admin
  now?: () => Date;
  config?: typeof ADMIN_AUTH_CONFIG;
}

/**
 * Login do super-admin. Senha E código TOTP são sempre exigidos; não existe caminho
 * sem 2FA nem função para desativá-lo (US-AUT-04). Sessões curtas (15 min de inatividade).
 */
export function createAdminAuthService({ db, now = () => new Date(), config = ADMIN_AUTH_CONFIG }: Deps) {
  const FAIL = { ok: false, reason: 'invalid_credentials' } as const;
  let dummyHash: Promise<string> | undefined;

  async function recordLoginFailure(sourceIp: string) {
    await db.$queryRaw<boolean[]>`SELECT append_auth_audit('ADMIN_LOGIN_FAILED', ${auditOrigin(sourceIp)})`;
  }

  async function login(emailRaw: string, password: string, totpCode: string, sourceIp = 'unknown'): Promise<AdminLoginResult> {
    const admin = await db.platformAdmin.findUnique({ where: { email: emailRaw.trim().toLowerCase() } });
    if (!admin) {
      dummyHash ??= hashPassword('dummy-password-0');
      await verifyPassword(password, await dummyHash);
      await recordLoginFailure(sourceIp);
      return FAIL;
    }
    if (admin.lockedUntil && admin.lockedUntil > now()) {
      await recordLoginFailure(sourceIp);
      return FAIL;
    }

    const passwordOk = await verifyPassword(password, admin.passwordHash);
    const step = verifyTotp(decryptSecret(admin.totpSecret), totpCode.trim(), now().getTime(), admin.totpLastStep);

    if (!passwordOk || step === null) {
      await recordLoginFailure(sourceIp);
      const updated = await db.platformAdmin.update({ where: { id: admin.id }, data: { failedLogins: { increment: 1 } } });
      if (updated.failedLogins >= config.maxFailedLogins) {
        await db.platformAdmin.update({
          where: { id: admin.id },
          data: { failedLogins: 0, lockedUntil: new Date(now().getTime() + config.lockMinutes * MIN) },
        });
      }
      return FAIL;
    }

    const upd = await db.platformAdmin.updateMany({
      where: { id: admin.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, failedLogins: 0 },
    });
    if (upd.count !== 1) {
      await recordLoginFailure(sourceIp);
      return FAIL; // código reutilizado em paralelo
    }

    const { token, hash } = newToken();
    await db.adminSession.create({ data: { tokenHash: hash, adminId: admin.id, createdAt: now(), lastSeenAt: now() } });
    await db.adminAuditLog.create({
      data: { adminId: admin.id, action: 'ADMIN_LOGIN', details: { sourceIp: auditOrigin(sourceIp) } },
    });
    return { ok: true, token };
  }

  async function validateSession(token: string): Promise<{ adminId: string } | null> {
    const s = await db.adminSession.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!s || s.revokedAt) return null;
    if (s.lastSeenAt.getTime() + config.sessionIdleMinutes * MIN <= now().getTime()) return null;
    await db.adminSession.update({ where: { id: s.id }, data: { lastSeenAt: now() } });
    return { adminId: s.adminId };
  }

  async function logout(token: string): Promise<void> {
    await db.adminSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now() } });
  }

  return { login, validateSession, logout };
}
