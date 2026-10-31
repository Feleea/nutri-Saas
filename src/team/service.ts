import { PrismaClient } from '@prisma/client';
import { forTenant } from '../db/tenant';
import { hashPassword, verifyPassword, validatePassword, newToken, hashToken } from '../auth/password';
import { TERMS_VERSION, type SessionInfo } from '../auth/service';
import type { Mailer } from '../auth/mailer';
import { appUrl } from '../auth/links';
import { auditOrigin } from '../auth/audit';

export const TEAM_CONFIG = { inviteDays: 7 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86_400_000;

export type InvitableRole = 'PROFISSIONAL' | 'SECRETARIA';
export type InviteResult =
  | { ok: true; invitationId: string }
  | { ok: false; reason: 'forbidden' | 'invalid_role' | 'invalid_email' | 'user_limit' | 'already_member' };
export type AcceptResult =
  | { ok: true; accountId: string; role: string }
  | { ok: false; reason: 'invalid_invite' | 'invalid_credentials' | 'validation' | 'user_limit' };
export interface AcceptInput {
  userName?: string;
  password?: string;
  acceptTerms?: boolean;
  acceptPrivacy?: boolean;
  acceptDpa?: boolean;
}

interface Deps {
  db: PrismaClient; // suasnutri_app
  mailer: Mailer;
  now?: () => Date;
  config?: typeof TEAM_CONFIG;
}

/** `session` vem de validateSession(): a autorização usa o papel da sessão, nunca dados do cliente. */
export function createTeamService({ db, mailer, now = () => new Date(), config = TEAM_CONFIG }: Deps) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);

  async function list(s: SessionInfo) {
    if (s.role !== 'TITULAR') return { ok: false as const, reason: 'forbidden' as const };
    const t = tenant(s);
    const [members, invitations] = await Promise.all([
      t.membership.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      t.invitation.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now() } },
        select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      ok: true as const,
      members: members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role, createdAt: m.createdAt })),
      invitations,
    };
  }

  async function invite(s: SessionInfo, emailRaw: string, role: InvitableRole, sourceIp = 'unknown'): Promise<InviteResult> {
    if (s.role !== 'TITULAR') return { ok: false, reason: 'forbidden' };
    if (role !== 'PROFISSIONAL' && role !== 'SECRETARIA') return { ok: false, reason: 'invalid_role' };
    const email = emailRaw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, reason: 'invalid_email' };

    const t = tenant(s);
    if ((await t.membership.count({ where: { user: { email } } })) > 0) return { ok: false, reason: 'already_member' };

    // limite do plano: membros + convites pendentes (de outros e-mails) não podem exceder userLimit
    const sub = await t.subscription.findUnique({ where: { accountId: s.accountId }, include: { plan: true } });
    const limit = sub?.plan.userLimit ?? null;
    const members = await t.membership.count();
    const pending = await t.invitation.count({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now() }, NOT: { email } },
    });
    if (limit !== null && members + pending >= limit) return { ok: false, reason: 'user_limit' };

    const previousInvites = await t.invitation.findMany({
      where: { email, acceptedAt: null, revokedAt: null },
      select: { id: true, role: true },
    });
    if (previousInvites.length) {
      await t.invitation.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now() },
      });
      await t.auditLog.createMany({
        data: previousInvites.map((previous) => ({
          accountId: s.accountId, actorUserId: s.userId, action: 'INVITE_REVOKED',
          resource: 'Invitation', resourceId: previous.id,
          details: { role: previous.role, reason: 'replaced' },
          ip: auditOrigin(sourceIp),
        })),
      });
    }
    const { token, hash } = newToken();
    const inv = await t.invitation.create({
      data: {
        accountId: s.accountId, email, role, tokenHash: hash, invitedByUserId: s.userId,
        expiresAt: new Date(now().getTime() + config.inviteDays * DAY), createdAt: now(),
      },
    });
    await t.auditLog.create({
      data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'INVITE_SENT',
        resource: 'Invitation', resourceId: inv.id, details: { role }, ip: auditOrigin(sourceIp),
      },
    });
    await mailer.send({
      to: email,
      kind: 'team_invite',
      subject: 'Convite para a equipe no Suas Nutri',
      text: `Você foi convidado (${role.toLowerCase()}). Aceite em até ${config.inviteDays} dias: ${appUrl('/convite')}?token=${token}`,
    });
    return { ok: true, invitationId: inv.id };
  }

  async function revokeInvite(s: SessionInfo, invitationId: string, sourceIp = 'unknown'): Promise<boolean> {
    if (s.role !== 'TITULAR') return false;
    const t = tenant(s);
    const invitation = await t.invitation.findFirst({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
    });
    if (!invitation) return false;
    const r = await t.invitation.updateMany({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now() },
    });
    if (r.count === 1) {
      await t.auditLog.create({
        data: {
          accountId: s.accountId, actorUserId: s.userId, action: 'INVITE_REVOKED',
          resource: 'Invitation', resourceId: invitationId, details: { role: invitation.role },
          ip: auditOrigin(sourceIp),
        },
      });
    }
    return r.count === 1;
  }

  /**
   * Conta e papel vêm do convite (no banco), não do chamador. Quem já tem usuário precisa
   * provar a senha; quem é novo cria a senha e aceita os termos.
   */
  async function acceptInvite(token: string, input: AcceptInput = {}, sourceIp = 'unknown'): Promise<AcceptResult> {
    const rows = await db.$queryRaw<{ account_id: string; role: string; user_id: string | null }[]>`
      SELECT account_id, role, user_id FROM invitation_peek(${hashToken(token)}, ${now()}::timestamptz)`;
    const inv = rows[0];
    if (!inv) return { ok: false, reason: 'invalid_invite' };

    let userId: string | null = inv.user_id;
    let userName: string | null = null;
    let passwordHash: string | null = null;

    if (userId) {
      const u = await db.user.findUnique({ where: { id: userId } });
      if (!u || !input.password || !(await verifyPassword(input.password, u.passwordHash))) {
        return { ok: false, reason: 'invalid_credentials' };
      }
    } else {
      const okTerms = input.acceptTerms && input.acceptPrivacy && input.acceptDpa;
      if (!input.userName?.trim() || !input.password || !validatePassword(input.password) || !okTerms) {
        return { ok: false, reason: 'validation' };
      }
      userName = input.userName.trim();
      passwordHash = await hashPassword(input.password);
    }

    try {
      const [r] = await db.$queryRaw<{ account_id: string | null }[]>`
        SELECT invitation_accept(${hashToken(token)}, ${now()}::timestamptz, ${userId}::text,
                                 ${userName}::text, ${passwordHash}::text, ${TERMS_VERSION}::text,
                                 ${auditOrigin(sourceIp)}::text) AS account_id`;
      if (!r?.account_id) return { ok: false, reason: 'invalid_invite' };
      return { ok: true, accountId: r.account_id, role: inv.role };
    } catch (e) {
      if (String(e).includes('user_limit')) return { ok: false, reason: 'user_limit' };
      throw e;
    }
  }

  /** Remove o acesso na hora (sessões revogadas); o histórico de ações da pessoa é mantido. */
  async function removeMember(s: SessionInfo, userId: string, sourceIp = 'unknown') {
    if (s.role !== 'TITULAR') return { ok: false as const, reason: 'forbidden' as const };
    if (userId === s.userId) return { ok: false as const, reason: 'cannot_remove_self' as const };
    const t = tenant(s);
    const m = await t.membership.findFirst({ where: { userId } });
    if (!m) return { ok: false as const, reason: 'not_found' as const };
    if (m.role === 'TITULAR') return { ok: false as const, reason: 'cannot_remove_titular' as const };

    await t.membership.delete({ where: { id: m.id } });
    await db.session.updateMany({ where: { userId, accountId: s.accountId, revokedAt: null }, data: { revokedAt: now() } });
    await t.auditLog.create({
      data: {
        accountId: s.accountId, actorUserId: s.userId, action: 'MEMBER_REMOVED',
        resource: 'Membership', resourceId: m.id, details: { role: m.role }, ip: auditOrigin(sourceIp),
      },
    });
    return { ok: true as const };
  }

  return { list, invite, revokeInvite, acceptInvite, removeMember };
}
