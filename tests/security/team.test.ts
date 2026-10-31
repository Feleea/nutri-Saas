import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { forTenant } from '../../src/db/tenant';
import { createAuthService, type SessionInfo } from '../../src/auth/service';
import { createTeamService } from '../../src/team/service';
import { MemoryMailer } from '../../src/auth/mailer';
import { hashToken } from '../../src/auth/password';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const mailer = new MemoryMailer();
let clock = Date.now();
const advanceDays = (d: number) => (clock += d * 86_400_000);
const now = () => new Date(clock);
const auth = createAuthService({ db, mailer, now });
const team = createTeamService({ db, mailer, now });

const PASSWORD = 'Senha-Forte-123';
const valid = (email: string) => ({
  accountName: 'Clínica Teste', userName: 'Titular Teste', email, password: PASSWORD,
  acceptTerms: true, acceptPrivacy: true, acceptDpa: true,
});
const tokenFrom = (to: string, kind: string) => {
  const mail = [...mailer.outbox].reverse().find((m) => m.to === to && m.kind === kind)!;
  return /token=([\w-]+)/.exec(mail.text)![1];
};
const newMember = { userName: 'Membro Novo', password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true };

/** Titular verificado num plano com limite de 2 usuários (plan_clinico_30). */
async function titular(email: string): Promise<{ session: SessionInfo; accountId: string }> {
  await auth.signup(valid(email));
  await auth.confirmEmail(tokenFrom(email, 'verify_email'));
  const u = await owner.user.findUniqueOrThrow({ where: { email } });
  const m = await owner.membership.findFirstOrThrow({ where: { userId: u.id } });
  await owner.subscription.update({ where: { accountId: m.accountId }, data: { planId: 'plan_clinico_30' } });
  const r = await auth.login(email, PASSWORD);
  if (!r.ok) throw new Error('login do titular falhou');
  return { session: (await auth.validateSession(r.token))!, accountId: m.accountId };
}

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await Promise.all([owner.$disconnect(), db.$disconnect()]); });

describe('US-AUT-05 · convidar membros da equipe [e2e][seg][api]', () => {
  it('envia convite com validade de 7 dias e guarda só o hash do token', async () => {
    const { session, accountId } = await titular('t1@example.test');
    const r = await team.invite(session, 'Prof1@Example.test', 'PROFISSIONAL', '203.0.113.8');
    expect(r.ok).toBe(true);
    const token = tokenFrom('prof1@example.test', 'team_invite');
    const inv = await owner.invitation.findFirstOrThrow({ where: { accountId } });
    expect(inv.tokenHash).toBe(hashToken(token));
    expect(inv.tokenHash).not.toBe(token);
    expect(inv.role).toBe('PROFISSIONAL');
    const log = await owner.auditLog.findFirstOrThrow({ where: { accountId, action: 'INVITE_SENT', resourceId: inv.id } });
    expect(log.actorUserId).toBe(session.userId);
    expect(log.details).toEqual({ role: 'PROFISSIONAL' });
    expect(log.ip).toBe('203.0.113.8');
    const days = (inv.expiresAt.getTime() - clock) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
  });

  it('o convidado novo entra no tenant que o convidou, com o papel definido, e nunca em outro', async () => {
    const { session, accountId } = await titular('t2@example.test');
    const other = await titular('t2-outro@example.test');
    await team.invite(session, 'prof2@example.test', 'PROFISSIONAL');

    const r = await team.acceptInvite(tokenFrom('prof2@example.test', 'team_invite'), newMember);
    expect(r).toEqual({ ok: true, accountId, role: 'PROFISSIONAL' });

    const u = await owner.user.findUniqueOrThrow({ where: { email: 'prof2@example.test' } });
    const ms = await owner.membership.findMany({ where: { userId: u.id } });
    expect(ms.map((m) => [m.accountId, m.role])).toEqual([[accountId, 'PROFISSIONAL']]);
    expect(ms.some((m) => m.accountId === other.accountId)).toBe(false);
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(await owner.termsAcceptance.count({ where: { userId: u.id } })).toBe(3);
    const roleGrant = await owner.auditLog.findFirstOrThrow({
      where: { accountId, action: 'MEMBER_ROLE_GRANTED', resourceId: ms[0].id },
    });
    expect(roleGrant.actorUserId).toBe(session.userId);
    expect(roleGrant.details).toEqual({ role: 'PROFISSIONAL' });

    const login = await auth.login('prof2@example.test', PASSWORD);
    expect(login.ok && login.accountId).toBe(accountId);
  });

  it('o convite expira em 7 dias e é de uso único', async () => {
    const { session } = await titular('t3@example.test');
    await team.invite(session, 'exp@example.test', 'SECRETARIA');
    const token = tokenFrom('exp@example.test', 'team_invite');
    advanceDays(8);
    expect(await team.acceptInvite(token, newMember)).toEqual({ ok: false, reason: 'invalid_invite' });

    await team.invite(session, 'uso1@example.test', 'SECRETARIA');
    const t2 = tokenFrom('uso1@example.test', 'team_invite');
    expect((await team.acceptInvite(t2, newMember)).ok).toBe(true);
    expect(await team.acceptInvite(t2, newMember)).toEqual({ ok: false, reason: 'invalid_invite' });
  });

  it('com o limite de usuários do plano atingido, novos convites são bloqueados (revogar libera a vaga)', async () => {
    const { session } = await titular('t4@example.test'); // plano com userLimit = 2 → titular + 1
    const first = await team.invite(session, 'v1@example.test', 'PROFISSIONAL');
    expect(first.ok).toBe(true);
    expect(await team.invite(session, 'v2@example.test', 'PROFISSIONAL')).toEqual({ ok: false, reason: 'user_limit' });
    if (!first.ok) throw new Error();
    expect(await team.revokeInvite(session, first.invitationId)).toBe(true);
    const revokeLog = await owner.auditLog.findFirstOrThrow({
      where: { accountId: session.accountId, action: 'INVITE_REVOKED', resourceId: first.invitationId },
    });
    expect(revokeLog.details).toEqual({ role: 'PROFISSIONAL' });
    expect((await team.invite(session, 'v2@example.test', 'PROFISSIONAL')).ok).toBe(true);
    // o convite revogado não pode mais ser aceito
    expect(await team.acceptInvite(tokenFrom('v1@example.test', 'team_invite'), newMember)).toEqual({ ok: false, reason: 'invalid_invite' });
  });

  it('um novo convite ao mesmo e-mail invalida o anterior', async () => {
    const { session } = await titular('t5@example.test');
    await team.invite(session, 'dup@example.test', 'PROFISSIONAL');
    const old = tokenFrom('dup@example.test', 'team_invite');
    const oldInvite = await owner.invitation.findFirstOrThrow({ where: { accountId: session.accountId, email: 'dup@example.test' } });
    await team.invite(session, 'dup@example.test', 'SECRETARIA');
    expect(await team.acceptInvite(old, newMember)).toEqual({ ok: false, reason: 'invalid_invite' });
    const revoked = await owner.auditLog.findFirstOrThrow({
      where: { accountId: session.accountId, action: 'INVITE_REVOKED', resourceId: oldInvite.id },
    });
    expect(revoked.details).toMatchObject({ role: 'PROFISSIONAL', reason: 'replaced' });
    const r = await team.acceptInvite(tokenFrom('dup@example.test', 'team_invite'), newMember);
    expect(r.ok && r.role).toBe('SECRETARIA');
  });

  it('remover o membro revoga o acesso na hora e preserva o histórico de ações dele', async () => {
    const { session, accountId } = await titular('t6@example.test');
    await team.invite(session, 'saindo@example.test', 'PROFISSIONAL');
    await team.acceptInvite(tokenFrom('saindo@example.test', 'team_invite'), newMember);
    const login = await auth.login('saindo@example.test', PASSWORD);
    if (!login.ok) throw new Error('login do membro falhou');
    expect(await auth.validateSession(login.token)).not.toBeNull();

    const member = await owner.user.findUniqueOrThrow({ where: { email: 'saindo@example.test' } });
    expect(await team.removeMember(session, member.id)).toEqual({ ok: true });

    expect(await auth.validateSession(login.token)).toBeNull();
    expect(await owner.membership.count({ where: { userId: member.id, accountId } })).toBe(0);
    const history = await owner.auditLog.count({ where: { accountId, actorUserId: member.id } });
    expect(history).toBeGreaterThan(0);
    const removed = await owner.auditLog.findFirstOrThrow({
      where: { accountId, action: 'MEMBER_REMOVED', actorUserId: session.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(removed.details).toEqual({ role: 'PROFISSIONAL' });
    expect(removed.resourceId).not.toBe(member.id);
    expect(await auth.login('saindo@example.test', PASSWORD)).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('só o titular convida, revoga e remove; ninguém remove a si mesmo nem outro titular', async () => {
    const { session, accountId } = await titular('t7@example.test');
    await team.invite(session, 'func@example.test', 'PROFISSIONAL');
    await team.acceptInvite(tokenFrom('func@example.test', 'team_invite'), newMember);
    const func = await owner.user.findUniqueOrThrow({ where: { email: 'func@example.test' } });
    const asProf: SessionInfo = { userId: func.id, accountId, role: 'PROFISSIONAL' };

    expect(await team.invite(asProf, 'x@example.test', 'SECRETARIA')).toEqual({ ok: false, reason: 'forbidden' });
    expect(await team.removeMember(asProf, session.userId)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await team.removeMember(session, session.userId)).toEqual({ ok: false, reason: 'cannot_remove_self' });
  });

  it('não é possível convidar alguém como titular nem com e-mail inválido; membro existente é recusado', async () => {
    const { session } = await titular('t8@example.test');
    expect(await team.invite(session, 'x@example.test', 'TITULAR' as never)).toEqual({ ok: false, reason: 'invalid_role' });
    expect(await team.invite(session, 'sem-arroba', 'SECRETARIA')).toEqual({ ok: false, reason: 'invalid_email' });
    expect(await team.invite(session, 't8@example.test', 'SECRETARIA')).toEqual({ ok: false, reason: 'already_member' });
  });

  it('quem já tem usuário precisa provar a senha e passa a ter vínculo também no novo tenant', async () => {
    const a = await titular('t9a@example.test');
    const b = await titular('t9b@example.test');
    await team.invite(a.session, 't9b@example.test', 'PROFISSIONAL');
    const token = tokenFrom('t9b@example.test', 'team_invite');
    const users = await owner.user.count();

    expect(await team.acceptInvite(token, {})).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(await team.acceptInvite(token, { password: 'Errada-12345' })).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(await team.acceptInvite(token, { password: PASSWORD })).toEqual({ ok: true, accountId: a.accountId, role: 'PROFISSIONAL' });

    const u = await owner.user.findUniqueOrThrow({ where: { email: 't9b@example.test' } });
    const ms = await owner.membership.findMany({ where: { userId: u.id } });
    expect(ms.map((m) => m.accountId).sort()).toEqual([a.accountId, b.accountId].sort());
    expect(await owner.user.count()).toBe(users); // nenhum usuário duplicado
  });

  it('cadastro do convidado novo exige senha forte e aceite dos termos; nada é gravado se falhar', async () => {
    const { session } = await titular('t10@example.test');
    await team.invite(session, 'novo10@example.test', 'SECRETARIA');
    const token = tokenFrom('novo10@example.test', 'team_invite');
    expect(await team.acceptInvite(token, { ...newMember, password: 'fraca' })).toEqual({ ok: false, reason: 'validation' });
    expect(await team.acceptInvite(token, { ...newMember, acceptDpa: false })).toEqual({ ok: false, reason: 'validation' });
    expect(await owner.user.count({ where: { email: 'novo10@example.test' } })).toBe(0);
    expect((await team.acceptInvite(token, newMember)).ok).toBe(true); // o convite continua válido
  });

  it('convites de um tenant são invisíveis para outro (RLS)', async () => {
    const a = await titular('t11a@example.test');
    const b = await titular('t11b@example.test');
    await team.invite(a.session, 'privado@example.test', 'SECRETARIA');
    const seenByB = await forTenant(b.accountId, undefined, db).invitation.findMany();
    expect(seenByB.some((i) => i.email === 'privado@example.test')).toBe(false);
    expect((await forTenant(a.accountId, undefined, db).invitation.findMany()).length).toBeGreaterThan(0);
  });
});
