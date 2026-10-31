import { Prisma, PrismaClient, type Module } from '@prisma/client';
import { hashToken } from '../auth/password';
import type { Mailer } from '../auth/mailer';
import type { Gateway } from './gateway';
import { accessMode, canAddPatient, type AccessMode } from './limits';

export const BILLING_CONFIG = { graceDays: 7, periodDays: 30 };
const DAY = 86_400_000;

export interface PlanInput {
  code: string;
  name: string;
  priceCents: number;
  modules: Module[];
  patientLimit?: number | null;
  userLimit?: number | null;
  storageMb?: number | null;
  activePatientDays?: number;
}
export type PlanPatch = Partial<Omit<PlanInput, 'code'>>;

interface Deps {
  db: PrismaClient; // conectado como suasnutri_admin: serviço de plataforma, nunca chamado direto pelo cliente
  mailer: Mailer;
  gateway: Gateway;
  now?: () => Date;
  config?: typeof BILLING_CONFIG;
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

function validatePlan(p: Partial<PlanInput>, partial = false): string[] {
  const errors: string[] = [];
  const posOrNull = (v: unknown) => v === undefined || v === null || (Number.isInteger(v) && (v as number) > 0);
  if (!partial || p.code !== undefined) if (!p.code?.trim()) errors.push('code_required');
  if (!partial || p.name !== undefined) if (!p.name?.trim()) errors.push('name_required');
  if (!partial || p.priceCents !== undefined) if (!Number.isInteger(p.priceCents) || (p.priceCents as number) < 0) errors.push('price_invalid');
  if (!partial || p.modules !== undefined) if (!p.modules?.length) errors.push('modules_required');
  if (!posOrNull(p.patientLimit)) errors.push('patient_limit_invalid');
  if (!posOrNull(p.userLimit)) errors.push('user_limit_invalid');
  if (!posOrNull(p.storageMb)) errors.push('storage_invalid');
  if (p.activePatientDays !== undefined && !(Number.isInteger(p.activePatientDays) && p.activePatientDays >= 1)) {
    errors.push('active_days_invalid');
  }
  return errors;
}

export function createBillingService({ db, mailer, gateway, now = () => new Date(), config = BILLING_CONFIG }: Deps) {
  const event = (tx: Prisma.TransactionClient | PrismaClient, accountId: string, kind: string, details?: Prisma.InputJsonValue) =>
    tx.tenantEvent.create({ data: { accountId, kind, details, createdAt: now() } });

  // ───────────── US-PLN-01: planos como configuração ─────────────
  async function createPlan(adminId: string, input: PlanInput) {
    const errors = validatePlan(input);
    if (errors.length) return { ok: false as const, errors };
    try {
      const plan = await db.plan.create({
        data: {
          code: input.code.trim(), name: input.name.trim(), priceCents: input.priceCents, modules: input.modules,
          patientLimit: input.patientLimit ?? null, userLimit: input.userLimit ?? null,
          storageMb: input.storageMb ?? null, activePatientDays: input.activePatientDays ?? 90,
        },
      });
      await db.adminAuditLog.create({ data: { adminId, action: 'PLAN_CREATED', details: { code: plan.code } } });
      return { ok: true as const, plan };
    } catch (e) {
      if (isUnique(e)) return { ok: false as const, errors: ['code_taken'] };
      throw e;
    }
  }

  /** Mudar o preço NÃO altera assinaturas vigentes: o novo valor entra na renovação. Os clientes são avisados. */
  async function updatePlan(adminId: string, code: string, patch: PlanPatch) {
    const errors = validatePlan(patch, true);
    if (errors.length) return { ok: false as const, errors };
    const plan = await db.plan.findUnique({ where: { code } });
    if (!plan) return { ok: false as const, errors: ['not_found'] };
    await db.plan.update({ where: { id: plan.id }, data: patch });

    let notified = 0;
    if (patch.priceCents !== undefined && patch.priceCents !== plan.priceCents) {
      const subs = await db.subscription.findMany({
        where: { planId: plan.id, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        include: { account: true },
      });
      for (const s of subs) {
        await mailer.send({
          to: s.account.email,
          kind: 'plan_price_changed',
          subject: 'Atualização de preço do seu plano',
          text: `O plano ${plan.name} passa de R$ ${(plan.priceCents / 100).toFixed(2)} para R$ ${(patch.priceCents / 100).toFixed(2)}. Seu valor atual (R$ ${(s.priceCents / 100).toFixed(2)}) vale até a próxima renovação.`,
        });
        notified++;
      }
    }
    await db.adminAuditLog.create({ data: { adminId, action: 'PLAN_UPDATED', details: { code, patch } as Prisma.InputJsonValue } });
    return { ok: true as const, notified };
  }

  /** Plano desativado deixa de ser oferecido, mas quem já o tem continua usando. */
  async function deactivatePlan(adminId: string, code: string) {
    const r = await db.plan.updateMany({ where: { code }, data: { active: false } });
    if (r.count) await db.adminAuditLog.create({ data: { adminId, action: 'PLAN_DEACTIVATED', details: { code } } });
    return r.count === 1;
  }

  const listOfferedPlans = () => db.plan.findMany({ where: { active: true }, orderBy: { priceCents: 'asc' } });

  // ───────────── US-PLN-02: contratar e pagar ─────────────
  /** Só registra a intenção: a assinatura é ativada quando o gateway confirmar o pagamento. */
  async function startCheckout(accountId: string, planCode: string, method: 'CARD' | 'PIX' | 'BOLETO') {
    const plan = await db.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.active) return { ok: false as const, reason: 'plan_unavailable' as const };
    const sub = await db.subscription.findUnique({ where: { accountId } });
    if (!sub) return { ok: false as const, reason: 'no_subscription' as const };
    const { gatewayRef } = gateway.createCharge({ accountId, amountCents: plan.priceCents, method });
    await db.subscription.update({ where: { accountId }, data: { pendingPlanId: plan.id, gatewayRef } });
    await event(db, accountId, 'CHECKOUT_STARTED', { plan: plan.code, method });
    return { ok: true as const, gatewayRef, amountCents: plan.priceCents };
  }

  type WebhookResult = { ok: true; duplicate: boolean } | { ok: false; reason: 'invalid_signature' | 'invalid_payload' };

  async function handleWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
    if (!gateway.verify(rawBody, signature)) {
      await db.paymentEvent.createMany({
        data: [{ gatewayEventId: `rejected:${hashToken(rawBody)}`, type: 'INVALID_SIGNATURE', processedAt: now() }],
        skipDuplicates: true,
      });
      return { ok: false, reason: 'invalid_signature' };
    }
    let ev;
    try {
      ev = gateway.parse(rawBody);
    } catch {
      return { ok: false, reason: 'invalid_payload' };
    }

    const notices: Array<() => Promise<void>> = [];
    try {
      await db.$transaction(async (tx) => {
        // o evento é gravado na mesma transação da mudança: reentrega ou concorrência cai no índice único
        await tx.paymentEvent.create({ data: { gatewayEventId: ev.eventId, type: ev.type, accountId: ev.accountId, processedAt: now() } });
        const sub = await tx.subscription.findUnique({ where: { accountId: ev.accountId } });
        if (!sub) return; // conta desconhecida: evento registrado, nada a alterar

        if (ev.type === 'PAYMENT_CONFIRMED') {
          const plan = await tx.plan.findUniqueOrThrow({ where: { id: sub.pendingPlanId ?? sub.planId } });
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              planId: plan.id, pendingPlanId: null, status: 'ACTIVE', graceEndsAt: null,
              priceCents: plan.priceCents, // renovação: passa a valer o preço atual do plano
              currentPeriodEnd: new Date(now().getTime() + config.periodDays * DAY),
            },
          });
          await tx.account.updateMany({ where: { id: ev.accountId, status: { notIn: ['SUSPENDED', 'CANCELED'] } }, data: { status: 'ACTIVE' } });
          await tx.invoice.create({
            data: { accountId: ev.accountId, amountCents: ev.amountCents ?? plan.priceCents, status: 'PAID', paidAt: now(), createdAt: now() },
          });
          await event(tx, ev.accountId, 'PAYMENT_CONFIRMED', { plan: plan.code, amountCents: ev.amountCents ?? plan.priceCents });
        } else {
          const graceEndsAt =
            sub.status === 'PAST_DUE' && sub.graceEndsAt ? sub.graceEndsAt : new Date(now().getTime() + config.graceDays * DAY);
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', graceEndsAt } });
          await tx.account.updateMany({ where: { id: ev.accountId, status: { notIn: ['SUSPENDED', 'CANCELED'] } }, data: { status: 'PAST_DUE' } });
          await event(tx, ev.accountId, 'PAYMENT_OVERDUE', { graceEndsAt: graceEndsAt.toISOString() });
          const account = await tx.account.findUniqueOrThrow({ where: { id: ev.accountId } });
          notices.push(() =>
            mailer.send({
              to: account.email,
              kind: 'payment_overdue',
              subject: 'Pagamento em atraso',
              text: `Não identificamos o pagamento da sua assinatura. Você mantém o acesso normal até ${graceEndsAt.toISOString().slice(0, 10)}.`,
            }),
          );
        }
      });
    } catch (e) {
      if (isUnique(e)) return { ok: true, duplicate: true };
      throw e;
    }
    for (const n of notices) await n();
    return { ok: true, duplicate: false };
  }

  // ───────────── US-PLN-03: upgrade e downgrade ─────────────
  async function changePlan(accountId: string, planCode: string) {
    const sub = await db.subscription.findUnique({ where: { accountId }, include: { plan: true } });
    if (!sub || sub.status !== 'ACTIVE') return { ok: false as const, reason: 'not_subscribed' as const };
    const target = await db.plan.findUnique({ where: { code: planCode } });
    if (!target || !target.active) return { ok: false as const, reason: 'plan_unavailable' as const };
    if (target.id === sub.planId) return { ok: false as const, reason: 'same_plan' as const };

    const upgrade = target.priceCents > sub.plan.priceCents;
    let prorationCents = 0;
    if (upgrade && sub.currentPeriodEnd) {
      const remaining = Math.min(1, Math.max(0, (sub.currentPeriodEnd.getTime() - now().getTime()) / (config.periodDays * DAY)));
      prorationCents = Math.round((target.priceCents - sub.priceCents) * remaining);
    }
    const counter = await db.usageCounter.findFirst({ where: { accountId }, orderBy: { date: 'desc' } });
    const patientsTotal = counter?.patientsTotal ?? 0;
    const excessPatients = !upgrade && target.patientLimit !== null ? Math.max(0, patientsTotal - target.patientLimit) : 0;

    await db.$transaction(async (tx) => {
      // novos limites valem na hora; downgrade nunca apaga pacientes (só bloqueia novos cadastros)
      await tx.subscription.update({ where: { id: sub.id }, data: { planId: target.id, priceCents: target.priceCents, pendingPlanId: null } });
      if (prorationCents > 0) {
        await tx.invoice.create({
          data: { accountId, amountCents: prorationCents, status: 'OPEN', note: `Ajuste proporcional: ${sub.plan.code} → ${target.code}`, createdAt: now() },
        });
      }
      await event(tx, accountId, 'PLAN_CHANGED', { from: sub.plan.code, to: target.code, kind: upgrade ? 'upgrade' : 'downgrade', prorationCents });
    });
    return { ok: true as const, kind: upgrade ? ('upgrade' as const) : ('downgrade' as const), prorationCents, excessPatients, patientLimit: target.patientLimit };
  }

  // ───────────── US-PLN-04: trial vencido e inadimplência ─────────────
  async function loadAccessState(accountId: string) {
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    const sub = await db.subscription.findUnique({ where: { accountId }, include: { plan: true } });
    const counter = await db.usageCounter.findFirst({ where: { accountId }, orderBy: { date: 'desc' } });
    const mode: AccessMode = accessMode(
      { accountStatus: account.status, trialEndsAt: account.trialEndsAt, graceEndsAt: sub?.graceEndsAt ?? null },
      now(),
    );
    const patientsTotal = counter?.patientsTotal ?? 0;
    const patientLimit = sub?.plan.patientLimit ?? null;
    return { mode, patientsTotal, patientLimit, planCode: sub?.plan.code ?? null, canAddPatient: canAddPatient(mode, patientsTotal, patientLimit) };
  }

  /** Job diário: avisa uma única vez quando a carência termina (idempotente por evento). */
  async function runBillingJob(): Promise<{ graceEndedNotices: number }> {
    const due = await db.subscription.findMany({
      where: { status: 'PAST_DUE', graceEndsAt: { lte: now() } },
      include: { account: true },
    });
    let sent = 0;
    for (const s of due) {
      try {
        await db.paymentEvent.create({
          data: { gatewayEventId: `grace-ended:${s.id}:${s.graceEndsAt!.getTime()}`, type: 'GRACE_ENDED', accountId: s.accountId, processedAt: now() },
        });
      } catch (e) {
        if (isUnique(e)) continue;
        throw e;
      }
      await event(db, s.accountId, 'GRACE_ENDED');
      await mailer.send({
        to: s.account.email,
        kind: 'grace_ended',
        subject: 'Carência encerrada',
        text: 'A carência terminou: novos cadastros de pacientes estão bloqueados. O acesso aos seus dados e a exportação continuam disponíveis. Regularize o pagamento para liberar.',
      });
      sent++;
    }
    return { graceEndedNotices: sent };
  }

  return { createPlan, updatePlan, deactivatePlan, listOfferedPlans, startCheckout, handleWebhook, changePlan, loadAccessState, runBillingJob };
}
