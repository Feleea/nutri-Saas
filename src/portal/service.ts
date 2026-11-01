import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SessionInfo } from '../auth/service';
import type { Mailer } from '../auth/mailer';
import { withTenant } from '../db/tenant';
import { appUrl } from '../auth/links';
import { decryptSecret, encryptSecret } from '../crypto/secrets';

export const PORTAL_COOKIE = 'sn_patient_portal';
export const PORTAL_INVITE_HOURS = 24;
export const PORTAL_PLAN_APPROVAL = 'PORTAL_MEAL_PLAN';

type PortalDb = PrismaClient & { patientPortalSession: any };
type PortalSessionRow = { id: string; accountId: string; patientId: string; expiresAt: Date; revokedAt: Date | null };
type MealPlanReader = {
  get(session: SessionInfo, patientId: string, planId: string): Promise<any>;
};
type Deps = { db: PrismaClient; mailer: Mailer; now?: () => Date };
type Failure = { ok: false; reason: string };
const failure = (reason: string): Failure => ({ ok: false, reason });
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
function createOpaqueToken(accountId: string) {
  const encrypted = encryptSecret(JSON.stringify({ accountId, nonce: newToken() }));
  return Buffer.from(encrypted, 'utf8').toString('base64url');
}
function tokenAccount(token: string): string | null {
  try {
    const encrypted = Buffer.from(token, 'base64url').toString('utf8');
    const value = JSON.parse(decryptSecret(encrypted)) as { accountId?: unknown; nonce?: unknown };
    return typeof value.accountId === 'string' && typeof value.nonce === 'string' ? value.accountId : null;
  } catch {
    return null;
  }
}
const isClinician = (session: SessionInfo) => ['TITULAR', 'PROFISSIONAL'].includes(session.role);

export function createPortalService({ db, mailer, now = () => new Date() }: Deps) {
  async function invite(session: SessionInfo, patientId: string, approvedPlanIds: string[]) {
    if (!isClinician(session)) return failure('forbidden');
    const token = createOpaqueToken(session.accountId);
    const expiresAt = new Date(now().getTime() + PORTAL_INVITE_HOURS * 60 * 60_000);
    const result = await withTenant(session.accountId, async (rawTx) => {
      const tx = rawTx as unknown as PortalDb;
      const patient = await tx.patient.findFirst({
        where: { id: patientId, status: 'ACTIVE' },
        select: { id: true, email: true, fullName: true },
      });
      if (!patient) return failure('not_found');
      if (!patient.email) return failure('patient_email_missing');

      const consent = await tx.patientConsent.findFirst({
        where: { patientId, kind: 'DATA_PROCESSING', revokedAt: null },
        select: { id: true },
      });
      if (!consent) return failure('consent_required');

      const uniquePlanIds = [...new Set(approvedPlanIds)];
      const plans = uniquePlanIds.length
        ? await tx.mealPlan.findMany({ where: { patientId, id: { in: uniquePlanIds } }, select: { id: true } })
        : [];
      if (plans.length !== uniquePlanIds.length) return failure('validation');

      const activeApprovals = await tx.patientConsent.findMany({
        where: { patientId, kind: PORTAL_PLAN_APPROVAL, revokedAt: null },
        select: { id: true, version: true },
      });
      const approvedSet = new Set(uniquePlanIds);
      const toRevoke = activeApprovals.filter((item: { version: string }) => !approvedSet.has(item.version));
      if (toRevoke.length) {
        await tx.patientConsent.updateMany({
          where: { id: { in: toRevoke.map((item: { id: string }) => item.id) } },
          data: { revokedAt: now() },
        });
      }
      const activeSet = new Set(activeApprovals.map((item: { version: string }) => item.version));
      for (const planId of uniquePlanIds) {
        if (!activeSet.has(planId)) {
          await tx.patientConsent.create({
            data: {
              accountId: session.accountId,
              patientId,
              kind: PORTAL_PLAN_APPROVAL,
              version: planId,
              recordedByUserId: session.userId,
              grantedAt: now(),
            },
          });
        }
      }

      await tx.patientPortalSession.updateMany({
        where: { patientId, revokedAt: null },
        data: { revokedAt: now() },
      });
      const invitation = await tx.patientPortalSession.create({
        data: {
          accountId: session.accountId,
          patientId,
          tokenHash: tokenHash(token),
          expiresAt,
          createdAt: now(),
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          accountId: session.accountId,
          actorUserId: session.userId,
          action: 'PATIENT_PORTAL_INVITED',
          resource: 'Patient',
          resourceId: patientId,
          createdAt: now(),
        },
      });
      return { ok: true as const, invitationId: invitation.id, expiresAt, email: patient.email, fullName: patient.fullName };
    }, db);
    if (!result.ok) return result;

    await mailer.send({
      to: result.email,
      kind: 'portal_invite',
      subject: 'Acesso ao portal do paciente',
      text: `Olá, ${result.fullName}.\n\nAcesse seu portal com este link de uso único, válido por 24 horas:\n${appUrl('/portal/redeem')}?token=${token}\n\nSe você não solicitou este acesso, ignore esta mensagem.`,
    });
    return { ok: true as const, invitationId: result.invitationId, expiresAt: result.expiresAt };
  }

  async function revoke(session: SessionInfo, invitationId: string) {
    if (!isClinician(session)) return failure('forbidden');
    return withTenant(session.accountId, async (rawTx) => {
      const tx = rawTx as unknown as PortalDb;
      const found = await tx.patientPortalSession.findFirst({
        where: { id: invitationId, revokedAt: null },
        select: { id: true, patientId: true },
      });
      if (!found) return failure('not_found');
      await tx.patientPortalSession.updateMany({
        where: { id: invitationId, revokedAt: null },
        data: { revokedAt: now() },
      });
      await tx.auditLog.create({
        data: {
          accountId: session.accountId,
          actorUserId: session.userId,
          action: 'PATIENT_PORTAL_REVOKED',
          resource: 'Patient',
          resourceId: found.patientId,
          createdAt: now(),
        },
      });
      return { ok: true as const };
    }, db);
  }

  async function active(session: SessionInfo, patientId: string) {
    if (!isClinician(session)) return failure('forbidden');
    return withTenant(session.accountId, async (tx) => {
      const portalDb = tx as unknown as PortalDb;
      const patient = await portalDb.patient.findFirst({
        where: { id: patientId, status: 'ACTIVE' },
        select: {
          consents: { where: { kind: 'DATA_PROCESSING', revokedAt: null }, select: { id: true }, take: 1 },
        },
      });
      if (!patient?.consents.length) return { ok: true as const, invitation: null };
      const invitation = await portalDb.patientPortalSession.findFirst({
        where: { patientId, revokedAt: null, expiresAt: { gt: now() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, expiresAt: true },
      });
      return { ok: true as const, invitation: invitation ?? null };
    }, db);
  }

  async function redeem(token: string) {
    if (!token || token.length > 500) return failure('invalid_portal_access');
    const inviteHash = tokenHash(token);
    const accountId = tokenAccount(token);
    if (!accountId) return failure('invalid_portal_access');
    const row = await withTenant<PortalSessionRow | null>(accountId, async (tx) =>
      await (tx as unknown as PortalDb).patientPortalSession.findUnique({
        where: { tokenHash: inviteHash },
        select: { id: true, accountId: true, patientId: true, expiresAt: true, revokedAt: true },
      }) as PortalSessionRow | null, db);
    if (!row || row.revokedAt || row.expiresAt <= now()) return failure('invalid_portal_access');

    const cookieToken = createOpaqueToken(row.accountId);
    const changed = await withTenant<{ count: number }>(row.accountId, async (tx) =>
      await (tx as unknown as PortalDb).patientPortalSession.updateMany({
        where: { id: row.id, tokenHash: inviteHash, revokedAt: null, expiresAt: { gt: now() } },
        data: { tokenHash: tokenHash(cookieToken), lastSeenAt: now() },
      }) as { count: number }, db);
    if (changed.count !== 1) return failure('invalid_portal_access');

    const allowed = await withTenant(row.accountId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: row.patientId, status: 'ACTIVE' },
        select: {
          id: true,
          consents: { where: { kind: 'DATA_PROCESSING', revokedAt: null }, select: { id: true }, take: 1 },
        },
      });
      return !!patient?.consents.length;
    }, db);
    if (!allowed) {
      await withTenant<{ count: number }>(row.accountId, async (tx) =>
        await (tx as unknown as PortalDb).patientPortalSession.updateMany({
          where: { id: row.id, tokenHash: tokenHash(cookieToken), revokedAt: null },
          data: { revokedAt: now() },
        }) as { count: number }, db);
      return failure('invalid_portal_access');
    }
    return { ok: true as const, token: cookieToken, expiresAt: row.expiresAt };
  }

  async function authenticate(token: string | null | undefined) {
    if (!token || token.length > 500) return null;
    const accountId = tokenAccount(token);
    if (!accountId) return null;
    const row = await withTenant<PortalSessionRow | null>(accountId, async (tx) => {
      const sessions = (tx as unknown as PortalDb).patientPortalSession;
      const found = await sessions.findUnique({
        where: { tokenHash: tokenHash(token) },
        select: { id: true, accountId: true, patientId: true, expiresAt: true, revokedAt: true },
      }) as PortalSessionRow | null;
      if (!found || found.revokedAt || found.expiresAt <= now()) return null;
      const updated = await sessions.updateMany({
        where: { id: found.id, tokenHash: tokenHash(token), revokedAt: null, expiresAt: { gt: now() } },
        data: { lastSeenAt: now() },
      });
      return updated.count === 1 ? found : null;
    }, db);
    if (!row) return null;
    const allowed = await withTenant(row.accountId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: row.patientId, status: 'ACTIVE' },
        select: {
          id: true,
          consents: { where: { kind: 'DATA_PROCESSING', revokedAt: null }, select: { id: true }, take: 1 },
        },
      });
      return !!patient?.consents.length;
    }, db);
    if (!allowed) {
      await withTenant(row.accountId, (tx) =>
        (tx as unknown as PortalDb).patientPortalSession.updateMany({
          where: { id: row.id, tokenHash: tokenHash(token), revokedAt: null },
          data: { revokedAt: now() },
        }), db);
      return null;
    }
    return { id: row.id, accountId: row.accountId, patientId: row.patientId, expiresAt: row.expiresAt };
  }

  async function content(token: string | null | undefined, mealPlans: MealPlanReader) {
    const portalSession = await authenticate(token);
    if (!portalSession) return failure('invalid_portal_access');
    const base = await withTenant(portalSession.accountId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: portalSession.patientId, status: 'ACTIVE' },
        select: {
          id: true,
          consents: { where: { kind: 'DATA_PROCESSING', revokedAt: null }, select: { id: true }, take: 1 },
        },
      });
      if (!patient?.consents.length) return null;
      const appointments = await tx.appointment.findMany({
        where: {
          patientId: portalSession.patientId,
          startsAt: { gte: now() },
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
        },
        orderBy: { startsAt: 'asc' },
        take: 50,
        select: {
          startsAt: true,
          endsAt: true,
          status: true,
          online: true,
          meetingUrl: true,
          professional: { select: { name: true } },
        },
      });
      const approvals = await tx.patientConsent.findMany({
        where: { patientId: portalSession.patientId, kind: PORTAL_PLAN_APPROVAL, revokedAt: null },
        select: { version: true },
      });
      const plans = approvals.length
        ? await tx.mealPlan.findMany({
          where: { patientId: portalSession.patientId, id: { in: approvals.map((item: { version: string }) => item.version) } },
          select: { id: true },
        })
        : [];
      return { appointments, planIds: plans.map((plan: { id: string }) => plan.id) };
    }, db);
    if (!base) {
      await logout(token);
      return failure('invalid_portal_access');
    }
    const approvedPlans = [];
    for (const planId of base.planIds) {
      const result = await mealPlans.get(
        { accountId: portalSession.accountId, userId: `portal:${portalSession.id}`, role: 'TITULAR' },
        portalSession.patientId,
        planId,
      );
      if (result.ok) approvedPlans.push(result.plan);
    }
    return {
      ok: true as const,
      appointments: base.appointments,
      mealPlans: approvedPlans,
    };
  }

  async function logout(token: string | null | undefined) {
    if (!token || token.length > 500) return;
    const accountId = tokenAccount(token);
    if (!accountId) return;
    await withTenant(accountId, (tx) =>
      (tx as unknown as PortalDb).patientPortalSession.updateMany({
        where: { tokenHash: tokenHash(token), revokedAt: null },
        data: { revokedAt: now() },
      }), db);
  }

  return { invite, revoke, active, redeem, authenticate, content, logout };
}
