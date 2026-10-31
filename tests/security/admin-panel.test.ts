import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A, TENANT_B } from '../../prisma/seed-data';
import { createAdminAuthService } from '../../src/auth/admin';
import { createAdminPanel, csvCell } from '../../src/admin/panel';
import { createBillingService } from '../../src/billing/service';
import { HmacGateway, signBody } from '../../src/billing/gateway';
import { MemoryMailer } from '../../src/auth/mailer';
import { hashPassword } from '../../src/auth/password';
import { encryptSecret } from '../../src/crypto/secrets';
import { generateSecret, totpCode } from '../../src/auth/totp';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
let clock = Date.now();
const now = () => new Date(clock);
const adminAuth = createAdminAuthService({ db: adminDb, now });
const panel = createAdminPanel({ db: adminDb, adminAuth, now });
const SECRET = 'segredo-webhook-painel';
const billing = createBillingService({ db: adminDb, mailer: new MemoryMailer(), gateway: new HmacGateway(SECRET), now });

const totp = generateSecret();
let token = '';
const ADMIN_ID = 'adm_panel';

beforeAll(async () => {
  await seedTenants(owner);
  await owner.platformAdmin.create({
    data: { id: ADMIN_ID, email: 'dono-painel@example.test', passwordHash: await hashPassword('Admin-Senha-123'), totpSecret: encryptSecret(totp) },
  });
  clock += 120_000;
  const r = await adminAuth.login('dono-painel@example.test', 'Admin-Senha-123', totpCode(totp, clock));
  if (!r.ok) throw new Error('login do admin falhou');
  token = r.token;
  await adminDb.$executeRaw`SELECT refresh_usage_counters()`;
});
afterAll(async () => { await Promise.all([owner.$disconnect(), adminDb.$disconnect()]); });

describe('US-ADM-00 · painel do dono: lista e detalhe de tenants [e2e][seg]', () => {
  it('sem sessão de super-admin (senha + 2FA), nada é exibido nem alterado', async () => {
    expect(await panel.listTenants('token-falso')).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await panel.getTenantDetail('', TENANT_A)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await panel.suspendAccount('x', TENANT_A, 'teste')).toEqual({ ok: false, reason: 'unauthorized' });
    expect((await owner.account.findUniqueOrThrow({ where: { id: TENANT_A } })).status).toBe('TRIAL');
  });

  it('mostra por tenant: plano, status, cadastro, último acesso, pacientes (total e ativos) e usuários', async () => {
    const r = await panel.listTenants(token);
    if (!r.ok) throw new Error();
    const a = r.tenants.find((t) => t.id === TENANT_A)!;
    const b = r.tenants.find((t) => t.id === TENANT_B)!;
    expect(a).toMatchObject({ plan: 'clinico-30', status: 'TRIAL', patientsTotal: 3, patientsActive: 2, users: 1, email: 'a@example.test' });
    expect(b).toMatchObject({ patientsTotal: 2, patientsActive: 2, users: 1 });
    expect(a.createdAt).toBeInstanceOf(Date);
    expect(a.countersDate).not.toBeNull();
  });

  it('nenhuma resposta do painel contém nome, contato ou dado de saúde de paciente', async () => {
    const list = await panel.listTenants(token);
    const detail = await panel.getTenantDetail(token, TENANT_A);
    const csv = await panel.exportTenantsCsv(token);
    const everything = JSON.stringify([list, detail, csv]);
    for (const leak of ['Paciente A1', 'Paciente A2', 'Paciente A3', 'Paciente B1', 'pat_a1', '000.000']) {
      expect(everything).not.toContain(leak);
    }
  });

  it('filtros por plano, status, faixa de pacientes, busca e inatividade', async () => {
    await owner.account.update({ where: { id: TENANT_A }, data: { lastAccessAt: new Date(clock - 2 * 86_400_000) } });
    await owner.account.update({ where: { id: TENANT_B }, data: { lastAccessAt: new Date(clock - 40 * 86_400_000) } });
    const ids = async (f: Parameters<typeof panel.listTenants>[1]) => {
      const r = await panel.listTenants(token, f);
      if (!r.ok) throw new Error();
      return r.tenants.map((t) => t.id).sort();
    };
    expect(await ids({ plan: 'clinico-30' })).toEqual([TENANT_A, TENANT_B].sort());
    expect(await ids({ plan: 'inexistente' })).toEqual([]);
    expect(await ids({ status: 'ACTIVE' })).toEqual([]);
    expect(await ids({ patientBand: '0-30' })).toEqual([TENANT_A, TENANT_B].sort());
    expect(await ids({ patientBand: '31-100' })).toEqual([]);
    expect(await ids({ q: 'nutri a' })).toEqual([TENANT_A]);
    expect(await ids({ inactiveSince: new Date(clock - 30 * 86_400_000) })).toEqual([TENANT_B]);
  });

  it('exporta CSV com cabeçalho, uma linha por tenant e proteção contra injeção de fórmula', async () => {
    await owner.account.create({ data: { id: 'acc_csv', name: '=HYPERLINK("http://x","clique"), Ltda', email: 'csv@example.test' } });
    const r = await panel.exportTenantsCsv(token, { q: 'csv@' });
    if (!r.ok) throw new Error();
    const [header, line] = r.csv.trim().split('\n');
    expect(header).toBe('id,nome,email,plano,status,pacientes_total,pacientes_ativos,usuarios,cadastro,ultimo_acesso');
    expect(r.rows).toBe(1);
    expect(line).toContain(`"'=HYPERLINK(""http://x"",""clique""), Ltda"`);
    expect(await owner.adminAuditLog.count({ where: { action: 'TENANTS_EXPORTED' } })).toBeGreaterThan(0);
  });

  it('detalhe do tenant traz conta, uso, faturas e linha do tempo (somente contagens)', async () => {
    const d = await panel.getTenantDetail(token, TENANT_A);
    if (!d.ok) throw new Error();
    expect(d.account).toMatchObject({ id: TENANT_A, name: 'Nutri A (sintético)' });
    expect(d.usage).toMatchObject({ patientsTotal: 3, patientsActive: 2, percentOfPatientLimit: 10 });
    expect(d.subscription).toMatchObject({ plan: 'clinico-30', patientLimit: 30 });
    expect(Object.keys(d).sort()).toEqual(['account', 'invoices', 'ok', 'subscription', 'timeline', 'usage']);
    expect(await panel.getTenantDetail(token, 'nao_existe')).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('US-ADM-00 · ações administrativas auditadas [api]', () => {
  it('suspender exige motivo, registra na auditoria e na linha do tempo; reativar volta ao estado anterior', async () => {
    expect(await panel.suspendAccount(token, TENANT_B, ' ')).toEqual({ ok: false, reason: 'reason_required' });
    expect(await panel.suspendAccount(token, TENANT_B, 'inadimplência prolongada')).toEqual({ ok: true });
    expect((await owner.account.findUniqueOrThrow({ where: { id: TENANT_B } })).status).toBe('SUSPENDED');
    const log = await owner.adminAuditLog.findFirstOrThrow({ where: { action: 'ACCOUNT_SUSPENDED', targetAccountId: TENANT_B } });
    expect(log.adminId).toBe(ADMIN_ID);
    expect(log.details).toMatchObject({ reason: 'inadimplência prolongada' });
    expect(await owner.tenantEvent.count({ where: { accountId: TENANT_B, kind: 'SUSPENDED' } })).toBe(1);
    expect(await panel.suspendAccount(token, TENANT_B, 'de novo')).toEqual({ ok: false, reason: 'not_applicable' });

    expect(await panel.reactivateAccount(token, TENANT_B)).toEqual({ ok: true, status: 'TRIAL' });
    expect(await owner.adminAuditLog.count({ where: { action: 'ACCOUNT_REACTIVATED', targetAccountId: TENANT_B } })).toBe(1);
  });

  it('um pagamento confirmado não desfaz a suspensão feita pelo dono', async () => {
    await panel.suspendAccount(token, TENANT_A, 'análise de fraude');
    const raw = JSON.stringify({ id: 'evt_painel_1', type: 'PAYMENT_CONFIRMED', accountId: TENANT_A });
    await billing.handleWebhook(raw, signBody(SECRET, raw));
    expect((await owner.account.findUniqueOrThrow({ where: { id: TENANT_A } })).status).toBe('SUSPENDED');
    await panel.reactivateAccount(token, TENANT_A);
  });

  it('estender trial: soma dias a partir do fim atual, limita a 60 e só vale para trial', async () => {
    const end = new Date(clock + 5 * 86_400_000);
    await owner.account.update({ where: { id: TENANT_A }, data: { status: 'TRIAL', trialEndsAt: end } });
    const r = await panel.extendTrial(token, TENANT_A, 7);
    if (!r.ok) throw new Error();
    expect(r.trialEndsAt.getTime()).toBe(end.getTime() + 7 * 86_400_000);
    expect(await panel.extendTrial(token, TENANT_A, 90)).toEqual({ ok: false, reason: 'invalid_days' });
    await owner.account.update({ where: { id: TENANT_A }, data: { status: 'ACTIVE' } });
    expect(await panel.extendTrial(token, TENANT_A, 7)).toEqual({ ok: false, reason: 'not_applicable' });
    expect(await owner.adminAuditLog.count({ where: { action: 'TRIAL_EXTENDED', targetAccountId: TENANT_A } })).toBe(1);
  });

  it('o admin continua sem permissão em qualquer tabela clínica, mesmo com sessão válida', async () => {
    for (const t of ['Patient', 'Unit', 'Membership', 'User', 'AuditLog', 'Food', 'DataExport', 'DeletionLedger', 'Invitation']) {
      await expect(adminDb.$queryRawUnsafe(`SELECT 1 FROM "${t}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    }
  });
});

describe('csvCell [unit]', () => {
  it('escapa aspas, separadores e prefixos de fórmula', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+55')).toBe("'+55");
    expect(csvCell(null)).toBe('');
    expect(csvCell(7)).toBe('7');
  });
});
