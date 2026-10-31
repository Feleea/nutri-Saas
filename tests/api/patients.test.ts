import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants } from '../../prisma/seed-data';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as confirmEmail } from '@/app/api/auth/confirm-email/route';
import { GET as me } from '@/app/api/me/route';
import { GET as listPatients, POST as createPatient } from '@/app/api/patients/route';
import { GET as getPatient, PATCH as patchPatient } from '@/app/api/patients/[id]/route';
import { POST as archive } from '@/app/api/patients/[id]/archive/route';
import { POST as restore } from '@/app/api/patients/[id]/restore/route';
import { POST as recordConsent } from '@/app/api/patients/[id]/consent/route';
import { POST as revokeConsent } from '@/app/api/patients/[id]/consent/revoke/route';
import { GET as listNotices } from '@/app/api/notices/route';
import { POST as readNotice } from '@/app/api/notices/[id]/read/route';
import { call, cookieOf, tokenFrom } from './helpers';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const PASSWORD = 'Senha-Forte-123';
const uniq = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function tenant(prefix: string, limit?: number) {
  const email = uniq(prefix);
  await call(signup, { body: { accountName: prefix, userName: prefix, email, password: PASSWORD, acceptTerms: true, acceptPrivacy: true, acceptDpa: true } });
  await call(confirmEmail, { body: { token: tokenFrom(email, 'verify_email') } });
  const cookie = cookieOf(await call(login, { body: { email, password: PASSWORD } }), 'sn_session');
  const { accountId } = (await call(me, { method: 'GET', cookie })).json;
  if (limit !== undefined) {
    const id = `plan_api_${limit}`;
    await owner.plan.upsert({ where: { id }, update: {}, create: { id, code: id, name: id, priceCents: 1, modules: ['CLINICO'], patientLimit: limit } });
    await owner.subscription.update({ where: { accountId }, data: { planId: id } });
  }
  const user = await owner.user.findUniqueOrThrow({ where: { email } });
  return { cookie, accountId, asRole: (role: 'TITULAR' | 'SECRETARIA') => owner.membership.updateMany({ where: { userId: user.id }, data: { role } }) };
}
const create = (cookie: string, fullName: string, extra: object = {}) =>
  call(createPatient, { cookie, body: { fullName, phone: '11999990000', ...extra } });

beforeAll(async () => { await seedTenants(owner); });
afterAll(async () => { await owner.$disconnect(); });

describe('API · pacientes [e2e][seg]', () => {
  it('cadastra (201), lista, busca sem acento e devolve a ficha com alerta de consentimento', async () => {
    const t = await tenant('pac');
    const c = await create(t.cookie, 'João da Silva', { tags: ['Atleta'], cpf: '529.982.247-25' });
    expect(c.status).toBe(201);
    expect(c.json.patient).toMatchObject({ fullName: 'João da Silva', status: 'ACTIVE', tags: ['atleta'] });

    const l = await call(listPatients, { method: 'GET', cookie: t.cookie, url: 'http://localhost/api/patients?q=JOAO' });
    expect(l.status).toBe(200);
    expect(l.json).toMatchObject({ total: 1, empty: false });
    expect(l.json.items[0]).toMatchObject({ fullName: 'João da Silva', cpf: '***.***.247-25', consentMissing: true });

    const g = await call(getPatient, { method: 'GET', cookie: t.cookie, params: { id: c.json.patient.id } });
    expect(g.json.alerts).toEqual(['consent_missing']);
    expect(g.json.patient.cpf).toBe('52998224725');

    const empty = await call(listPatients, { method: 'GET', cookie: t.cookie, url: 'http://localhost/api/patients?q=ninguem' });
    expect(empty.json).toMatchObject({ empty: true, total: 0, items: [] });
  });

  it('validação e CPF duplicado voltam com o código certo', async () => {
    const t = await tenant('val');
    const bad = await create(t.cookie, '  ');
    expect([bad.status, bad.json.error.code, bad.json.error.errors]).toEqual([422, 'validation', ['name_required']]);
    expect((await call(createPatient, { cookie: t.cookie, body: { fullName: 'X' } })).json.error.errors).toEqual(['contact_required']);

    await create(t.cookie, 'Primeiro', { cpf: '11144477735' });
    const dup = await create(t.cookie, 'Segundo', { cpf: '111.444.777-35' });
    expect([dup.status, dup.json.error.code, dup.json.error.needsConfirm]).toEqual([409, 'duplicate_cpf', true]);
    expect((await create(t.cookie, 'Segundo', { cpf: '111.444.777-35', confirmDuplicate: true })).status).toBe(201);
  });

  it('editar, arquivar, restaurar e registrar/revogar consentimento', async () => {
    const t = await tenant('ciclo');
    const id = (await create(t.cookie, 'Ciclo de Vida')).json.patient.id;

    const p = await call(patchPatient, { method: 'PATCH', cookie: t.cookie, params: { id }, body: { goal: 'saúde', tags: ['Novo'] } });
    expect(p.json.patient).toMatchObject({ goal: 'saúde', tags: ['novo'] });
    expect((await call(patchPatient, { method: 'PATCH', cookie: t.cookie, params: { id }, body: { phone: null } })).status).toBe(422);

    expect((await call(recordConsent, { cookie: t.cookie, params: { id } })).status).toBe(201);
    expect((await call(getPatient, { method: 'GET', cookie: t.cookie, params: { id } })).json.alerts).toEqual([]);
    expect((await call(revokeConsent, { cookie: t.cookie, params: { id } })).json).toEqual({ revoked: 1 });
    expect((await call(getPatient, { method: 'GET', cookie: t.cookie, params: { id } })).json.alerts).toEqual(['consent_missing']);

    expect((await call(archive, { cookie: t.cookie, params: { id } })).status).toBe(200);
    expect((await call(archive, { cookie: t.cookie, params: { id } })).json.error.code).toBe('already_archived');
    const arch = await call(listPatients, { method: 'GET', cookie: t.cookie, url: 'http://localhost/api/patients?status=ARCHIVED' });
    expect(arch.json.total).toBe(1);
    expect((await call(restore, { cookie: t.cookie, params: { id } })).status).toBe(200);
  });

  it('um tenant não lê, edita, arquiva nem registra consentimento em paciente de outro', async () => {
    const a = await tenant('iso-a');
    const b = await tenant('iso-b');
    const id = (await create(a.cookie, 'Paciente do A')).json.patient.id;

    expect((await call(getPatient, { method: 'GET', cookie: b.cookie, params: { id } })).status).toBe(404);
    expect((await call(patchPatient, { method: 'PATCH', cookie: b.cookie, params: { id }, body: { goal: 'x' } })).status).toBe(404);
    expect((await call(archive, { cookie: b.cookie, params: { id } })).status).toBe(404);
    expect((await call(recordConsent, { cookie: b.cookie, params: { id } })).status).toBe(404);
    const lb = await call(listPatients, { method: 'GET', cookie: b.cookie, url: 'http://localhost/api/patients?status=ALL' });
    expect(lb.text).not.toContain('Paciente do A');
  });

  it('a secretária recebe 403 em toda a área de pacientes', async () => {
    const t = await tenant('sec');
    const id = (await create(t.cookie, 'Paciente Sigiloso')).json.patient.id;
    await t.asRole('SECRETARIA');
    const rs = [
      await call(listPatients, { method: 'GET', cookie: t.cookie }),
      await create(t.cookie, 'Outro'),
      await call(getPatient, { method: 'GET', cookie: t.cookie, params: { id } }),
      await call(patchPatient, { method: 'PATCH', cookie: t.cookie, params: { id }, body: { goal: 'x' } }),
      await call(archive, { cookie: t.cookie, params: { id } }),
      await call(recordConsent, { cookie: t.cookie, params: { id } }),
    ];
    expect(rs.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(rs.map((r) => r.text).join('')).not.toContain('Paciente Sigiloso');
  });

  it('sem sessão, nada funciona', async () => {
    expect((await call(listPatients, { method: 'GET' })).status).toBe(401);
    expect((await call(createPatient, { body: { fullName: 'x', phone: '11999990000' } })).status).toBe(401);
  });
});

describe('API · limite do plano e avisos [e2e]', () => {
  it('no limite: 409 patient_limit com convite ao upgrade, acesso aos existentes intacto e aviso ao titular', async () => {
    const t = await tenant('lim', 3);
    for (const n of ['Um', 'Dois']) expect((await create(t.cookie, n)).status).toBe(201); // 2/3 = 67%
    expect((await call(listNotices, { method: 'GET', cookie: t.cookie })).json.notices).toEqual([]);
    expect((await create(t.cookie, 'Três')).status).toBe(201); // 3/3

    const blocked = await create(t.cookie, 'Quatro');
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toMatchObject({ code: 'patient_limit', limit: 3, count: 3, upgrade: true });

    const list = await call(listPatients, { method: 'GET', cookie: t.cookie });
    expect(list.json.total).toBe(3);
    const first = list.json.items[0].id;
    expect((await call(getPatient, { method: 'GET', cookie: t.cookie, params: { id: first } })).status).toBe(200);
    expect((await call(patchPatient, { method: 'PATCH', cookie: t.cookie, params: { id: first }, body: { goal: 'ok' } })).status).toBe(200);

    const n = await call(listNotices, { method: 'GET', cookie: t.cookie });
    expect(n.json.notices.map((x: any) => x.kind).sort()).toEqual(['LIMIT_100', 'LIMIT_80']);
    expect((await call(readNotice, { cookie: t.cookie, params: { id: n.json.notices[0].id } })).status).toBe(200);
    expect((await call(listNotices, { method: 'GET', cookie: t.cookie })).json.notices).toHaveLength(1);
  });

  it('o aviso é de cobrança: só o titular vê; um aviso de outro tenant não é visível nem marcável', async () => {
    const a = await tenant('av-a', 1);
    const b = await tenant('av-b', 1);
    await create(a.cookie, 'Um'); // 1/1
    const noticeId = (await call(listNotices, { method: 'GET', cookie: a.cookie })).json.notices[0].id;

    expect((await call(listNotices, { method: 'GET', cookie: b.cookie })).json.notices).toEqual([]);
    expect((await call(readNotice, { cookie: b.cookie, params: { id: noticeId } })).status).toBe(404);
    await a.asRole('SECRETARIA');
    expect((await call(listNotices, { method: 'GET', cookie: a.cookie })).status).toBe(403);
  });

  it('plano sem vagas impede restaurar; trial vencido bloqueia o cadastro com 403', async () => {
    const t = await tenant('restr', 2);
    const id = (await create(t.cookie, 'Arquivar Depois')).json.patient.id;
    await call(archive, { cookie: t.cookie, params: { id } });
    await create(t.cookie, 'Ocupa 1');
    await create(t.cookie, 'Ocupa 2');
    expect((await call(restore, { cookie: t.cookie, params: { id } })).json.error.code).toBe('patient_limit');

    await owner.subscription.update({ where: { accountId: t.accountId }, data: { status: 'TRIAL' } });
    await owner.account.update({ where: { id: t.accountId }, data: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - 86_400_000) } });
    const r = await create(t.cookie, 'Depois do Trial');
    expect([r.status, r.json.error.code]).toEqual([403, 'access_restricted']);
    expect((await call(listPatients, { method: 'GET', cookie: t.cookie })).status).toBe(200);
  });
});
