import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTenants, TENANT_A } from '../../prisma/seed-data';
import { createBillingService } from '../../src/billing/service';
import { HmacGateway, signBody } from '../../src/billing/gateway';
import { MemoryMailer } from '../../src/auth/mailer';
import { hashPassword } from '../../src/auth/password';
import { encryptSecret } from '../../src/crypto/secrets';
import { forTenant } from '../../src/db/tenant';

const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_OWNER });
const adminDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_ADMIN });
const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const SECRET = 'segredo-webhook-de-teste';
const mailer = new MemoryMailer();
let clock = Date.now();
const advanceDays = (d: number) => (clock += d * 86_400_000);
const billing = createBillingService({ db: adminDb, mailer, gateway: new HmacGateway(SECRET), now: () => new Date(clock) });
const ADMIN_ID = 'adm_billing';

let seq = 0;
const send = (body: object, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return billing.handleWebhook(raw, signBody(secret, raw));
};
const evt = (type: 'PAYMENT_CONFIRMED' | 'PAYMENT_OVERDUE', accountId: string, extra: object = {}) =>
  ({ id: `evt_${++seq}`, type, accountId, ...extra });

async function mkAccount(id: string, opts: { patients?: number; trialEndsAt?: Date } = {}) {
  await owner.account.create({ data: { id, name: id, email: `${id}@example.test`, trialEndsAt: opts.trialEndsAt } });
  await owner.subscription.create({ data: { accountId: id, planId: 'plan_clinico_30' } });
  for (let i = 0; i < (opts.patients ?? 0); i++) {
    await owner.patient.create({ data: { id: `${id}_p${i}`, accountId: id, fullName: `Sintético ${i}` } });
  }
}
const refresh = () => adminDb.$executeRaw`SELECT refresh_usage_counters()`;
const sub = (accountId: string) => owner.subscription.findUniqueOrThrow({ where: { accountId }, include: { plan: true } });

beforeAll(async () => {
  await seedTenants(owner);
  await owner.platformAdmin.create({
    data: { id: ADMIN_ID, email: 'billing@example.test', passwordHash: await hashPassword('x'), totpSecret: encryptSecret('x') },
  });
});
afterAll(async () => { await Promise.all([owner.$disconnect(), adminDb.$disconnect(), appDb.$disconnect()]); });

describe('US-PLN-01 · planos como configuração [e2e][api]', () => {
  it('cria plano com limites e ele fica disponível; ação registrada na auditoria do admin', async () => {
    const r = await billing.createPlan(ADMIN_ID, {
      code: 'clinico-100', name: 'Clínico até 100', priceCents: 9900, modules: ['CLINICO'],
      patientLimit: 100, userLimit: 5, storageMb: 2000,
    });
    expect(r.ok).toBe(true);
    expect((await billing.listOfferedPlans()).map((p) => p.code)).toContain('clinico-100');
    expect(await owner.adminAuditLog.count({ where: { adminId: ADMIN_ID, action: 'PLAN_CREATED' } })).toBe(1);
  });

  it('recusa plano inválido e código repetido', async () => {
    expect(await billing.createPlan(ADMIN_ID, { code: '', name: '', priceCents: -1, modules: [], patientLimit: 0 })).toMatchObject({ ok: false });
    expect(await billing.createPlan(ADMIN_ID, { code: 'clinico-100', name: 'x', priceCents: 1, modules: ['CLINICO'] }))
      .toEqual({ ok: false, errors: ['code_taken'] });
  });

  it('alterar o preço mantém o valor das assinaturas vigentes até a renovação e avisa os clientes', async () => {
    await mkAccount('acc_price');
    await billing.startCheckout('acc_price', 'clinico-30', 'PIX');
    await send(evt('PAYMENT_CONFIRMED', 'acc_price'));
    expect((await sub('acc_price')).priceCents).toBe(4900);

    const r = await billing.updatePlan(ADMIN_ID, 'clinico-30', { priceCents: 5900 });
    expect(r).toMatchObject({ ok: true });
    expect((await sub('acc_price')).priceCents).toBe(4900);
    expect(mailer.outbox.some((m) => m.to === 'acc_price@example.test' && m.kind === 'plan_price_changed')).toBe(true);

    await send(evt('PAYMENT_CONFIRMED', 'acc_price')); // renovação
    expect((await sub('acc_price')).priceCents).toBe(5900);
    await billing.updatePlan(ADMIN_ID, 'clinico-30', { priceCents: 4900 });
  });

  it('plano desativado deixa de ser oferecido, mas quem já o tem continua usando', async () => {
    await mkAccount('acc_deact');
    await billing.createPlan(ADMIN_ID, { code: 'legado', name: 'Legado', priceCents: 1000, modules: ['CLINICO'], patientLimit: 10 });
    await billing.startCheckout('acc_deact', 'legado', 'PIX');
    await send(evt('PAYMENT_CONFIRMED', 'acc_deact'));
    await billing.deactivatePlan(ADMIN_ID, 'legado');

    expect((await billing.listOfferedPlans()).map((p) => p.code)).not.toContain('legado');
    expect((await sub('acc_deact')).status).toBe('ACTIVE');
    expect((await sub('acc_deact')).plan.code).toBe('legado');
    expect(await billing.startCheckout('acc_deact', 'legado', 'PIX')).toEqual({ ok: false, reason: 'plan_unavailable' });
  });

  it('a regra de "paciente ativo" é um parâmetro do plano, não um valor fixo no código', async () => {
    await refresh();
    const before = await adminDb.usageCounter.findFirstOrThrow({ where: { accountId: TENANT_A } });
    expect(before.patientsActive).toBe(2);

    await billing.updatePlan(ADMIN_ID, 'clinico-30', { activePatientDays: 5 });
    await refresh();
    const after = await adminDb.usageCounter.findFirstOrThrow({ where: { accountId: TENANT_A } });
    expect(after.patientsActive).toBe(1); // só o paciente com atividade há 1 dia
    await billing.updatePlan(ADMIN_ID, 'clinico-30', { activePatientDays: 90 });
  });
});

describe('US-PLN-02 · contratar e pagar [e2e][api][seg]', () => {
  it('o checkout não ativa a assinatura; só a confirmação do gateway ativa e gera fatura', async () => {
    await mkAccount('acc_pay');
    const c = await billing.startCheckout('acc_pay', 'clinico-30', 'BOLETO');
    expect(c).toMatchObject({ ok: true, amountCents: 4900 });
    expect((await sub('acc_pay')).status).toBe('TRIAL');

    expect(await send(evt('PAYMENT_CONFIRMED', 'acc_pay'))).toEqual({ ok: true, duplicate: false });
    const s = await sub('acc_pay');
    expect(s.status).toBe('ACTIVE');
    expect(s.pendingPlanId).toBeNull();
    expect((await owner.account.findUniqueOrThrow({ where: { id: 'acc_pay' } })).status).toBe('ACTIVE');
    const invoices = await owner.invoice.findMany({ where: { accountId: 'acc_pay' } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('PAID');
  });

  it('a fatura fica visível ao próprio tenant e a nenhum outro', async () => {
    const mine = await forTenant('acc_pay', undefined, appDb).invoice.findMany();
    const theirs = await forTenant(TENANT_A, undefined, appDb).invoice.findMany();
    expect(mine).toHaveLength(1);
    expect(mine[0].accountId).toBe('acc_pay');
    expect(theirs.some((i) => i.accountId === 'acc_pay')).toBe(false);
  });

  it('o mesmo webhook enviado de novo é aplicado uma única vez (idempotência)', async () => {
    await mkAccount('acc_idem');
    await billing.startCheckout('acc_idem', 'clinico-30', 'PIX');
    const body = evt('PAYMENT_CONFIRMED', 'acc_idem');
    expect(await send(body)).toEqual({ ok: true, duplicate: false });
    expect(await send(body)).toEqual({ ok: true, duplicate: true });
    expect(await owner.invoice.count({ where: { accountId: 'acc_idem' } })).toBe(1);
  });

  it('reentregas simultâneas também são aplicadas uma única vez', async () => {
    await mkAccount('acc_race');
    await billing.startCheckout('acc_race', 'clinico-30', 'PIX');
    const body = evt('PAYMENT_CONFIRMED', 'acc_race');
    const results = await Promise.all(Array.from({ length: 6 }, () => send(body)));
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(await owner.invoice.count({ where: { accountId: 'acc_race' } })).toBe(1);
  });

  it('assinatura inválida é rejeitada, registrada e não altera nada', async () => {
    await mkAccount('acc_sig');
    const raw = JSON.stringify(evt('PAYMENT_CONFIRMED', 'acc_sig'));
    expect(await billing.handleWebhook(raw, signBody('outro-segredo', raw))).toEqual({ ok: false, reason: 'invalid_signature' });
    expect((await sub('acc_sig')).status).toBe('TRIAL');
    expect(await owner.paymentEvent.count({ where: { type: 'INVALID_SIGNATURE' } })).toBeGreaterThan(0);
  });

  it('payload malformado com assinatura válida é recusado', async () => {
    const raw = JSON.stringify({ foo: 'bar' });
    expect(await billing.handleWebhook(raw, signBody(SECRET, raw))).toEqual({ ok: false, reason: 'invalid_payload' });
  });

  it('o app (nutricionistas) não tem acesso a eventos de pagamento nem à linha do tempo', async () => {
    for (const t of ['PaymentEvent', 'TenantEvent']) {
      await expect(appDb.$queryRawUnsafe(`SELECT 1 FROM "${t}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    }
  });
});

describe('US-PLN-03 · trocar de plano [api]', () => {
  it('upgrade: novos limites valem na hora, ajuste proporcional vira fatura em aberto e o evento entra na linha do tempo', async () => {
    await mkAccount('acc_up');
    await billing.startCheckout('acc_up', 'clinico-30', 'PIX');
    await send(evt('PAYMENT_CONFIRMED', 'acc_up'));
    advanceDays(15); // metade do ciclo

    const r = await billing.changePlan('acc_up', 'clinico-100');
    expect(r).toMatchObject({ ok: true, kind: 'upgrade', patientLimit: 100 });
    if (!r.ok) throw new Error();
    expect(r.prorationCents).toBeGreaterThan(2000);
    expect(r.prorationCents).toBeLessThan(3000); // ~ (9900-4900)/2
    expect((await sub('acc_up')).plan.code).toBe('clinico-100');
    const open = await owner.invoice.findMany({ where: { accountId: 'acc_up', status: 'OPEN' } });
    expect(open).toHaveLength(1);
    expect(await owner.tenantEvent.count({ where: { accountId: 'acc_up', kind: 'PLAN_CHANGED' } })).toBe(1);
  });

  it('downgrade abaixo do nº de pacientes: informa o excesso, não apaga ninguém e só bloqueia novos cadastros', async () => {
    await billing.createPlan(ADMIN_ID, { code: 'basico-5', name: 'Básico 5', priceCents: 1900, modules: ['CLINICO'], patientLimit: 5, userLimit: 1 });
    await mkAccount('acc_down', { patients: 12 });
    await billing.startCheckout('acc_down', 'clinico-100', 'PIX');
    await send(evt('PAYMENT_CONFIRMED', 'acc_down'));
    await refresh();

    const r = await billing.changePlan('acc_down', 'basico-5');
    expect(r).toMatchObject({ ok: true, kind: 'downgrade', excessPatients: 7 });
    expect(await owner.patient.count({ where: { accountId: 'acc_down' } })).toBe(12);
    const state = await billing.loadAccessState('acc_down');
    expect(state).toMatchObject({ mode: 'FULL', patientsTotal: 12, patientLimit: 5, canAddPatient: false });
  });

  it('recusa trocar para o mesmo plano, para plano indisponível ou sem assinatura ativa', async () => {
    expect(await billing.changePlan('acc_up', 'clinico-100')).toEqual({ ok: false, reason: 'same_plan' });
    expect(await billing.changePlan('acc_up', 'legado')).toEqual({ ok: false, reason: 'plan_unavailable' });
    await mkAccount('acc_trial_only');
    expect(await billing.changePlan('acc_trial_only', 'clinico-100')).toEqual({ ok: false, reason: 'not_subscribed' });
  });
});

describe('US-PLN-04 · fim do trial e inadimplência [e2e][api]', () => {
  it('trial vencido sem assinatura: somente leitura, convite a contratar, nenhum dado apagado', async () => {
    await mkAccount('acc_trial', { patients: 3, trialEndsAt: new Date(clock + 14 * 86_400_000) });
    expect((await billing.loadAccessState('acc_trial')).mode).toBe('FULL');
    advanceDays(15);
    const s = await billing.loadAccessState('acc_trial');
    expect(s.mode).toBe('READ_ONLY');
    expect(s.canAddPatient).toBe(false);
    expect(await owner.patient.count({ where: { accountId: 'acc_trial' } })).toBe(3);
  });

  it('atraso: avisa, mantém acesso na carência, bloqueia só novos cadastros depois e avisa uma única vez', async () => {
    await mkAccount('acc_late', { patients: 2 });
    await billing.startCheckout('acc_late', 'clinico-30', 'PIX');
    await send(evt('PAYMENT_CONFIRMED', 'acc_late'));
    await refresh();

    await send(evt('PAYMENT_OVERDUE', 'acc_late'));
    expect(mailer.outbox.some((m) => m.to === 'acc_late@example.test' && m.kind === 'payment_overdue')).toBe(true);
    expect((await sub('acc_late')).status).toBe('PAST_DUE');
    expect((await billing.loadAccessState('acc_late')).mode).toBe('FULL'); // carência

    advanceDays(6);
    expect((await billing.loadAccessState('acc_late')).mode).toBe('FULL');
    advanceDays(2); // passou dos 7 dias
    const s = await billing.loadAccessState('acc_late');
    expect(s.mode).toBe('NO_NEW_PATIENTS');
    expect(s.canAddPatient).toBe(false);
    expect(await owner.patient.count({ where: { accountId: 'acc_late' } })).toBe(2); // dados intactos

    expect(await billing.runBillingJob()).toEqual({ graceEndedNotices: 1 });
    expect(await billing.runBillingJob()).toEqual({ graceEndedNotices: 0 }); // idempotente
    expect(mailer.outbox.filter((m) => m.to === 'acc_late@example.test' && m.kind === 'grace_ended')).toHaveLength(1);
  });

  it('um segundo aviso de atraso não reinicia a carência', async () => {
    await mkAccount('acc_late2');
    await billing.startCheckout('acc_late2', 'clinico-30', 'PIX');
    await send(evt('PAYMENT_CONFIRMED', 'acc_late2'));
    await send(evt('PAYMENT_OVERDUE', 'acc_late2'));
    const first = (await sub('acc_late2')).graceEndsAt!;
    advanceDays(2);
    await send(evt('PAYMENT_OVERDUE', 'acc_late2'));
    expect((await sub('acc_late2')).graceEndsAt!.getTime()).toBe(first.getTime());
  });

  it('regularizado o pagamento, o acesso normal volta automaticamente', async () => {
    await send(evt('PAYMENT_CONFIRMED', 'acc_late'));
    const s = await billing.loadAccessState('acc_late');
    expect(s.mode).toBe('FULL');
    expect((await sub('acc_late')).graceEndsAt).toBeNull();
  });
});
