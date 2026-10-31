import { PrismaClient, Prisma, type AccountStatus } from '@prisma/client';
import type { createAdminAuthService } from '../auth/admin';
import { auditOrigin } from '../auth/audit';

export type PatientBand = '0-30' | '31-100' | '101-300' | '300+';
export interface TenantFilters {
  q?: string;
  plan?: string;
  status?: AccountStatus;
  patientBand?: PatientBand;
  createdFrom?: Date;
  createdTo?: Date;
  /** Sem acesso desde esta data (risco de cancelamento). */
  inactiveSince?: Date;
}

export interface TenantRow {
  id: string;
  name: string;
  email: string;
  plan: string | null;
  status: AccountStatus;
  patientsTotal: number;
  patientsActive: number;
  users: number;
  createdAt: Date;
  lastAccessAt: Date | null;
  countersDate: Date | null;
}

type Unauthorized = { ok: false; reason: 'unauthorized' };
const UNAUTH: Unauthorized = { ok: false, reason: 'unauthorized' };

const inBand = (n: number, b: PatientBand) =>
  b === '0-30' ? n <= 30 : b === '31-100' ? n > 30 && n <= 100 : b === '101-300' ? n > 100 && n <= 300 : n > 300;

/** Células que começam com = + - @ viram texto (evita injeção de fórmula ao abrir no Excel/Sheets). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Deps {
  db: PrismaClient; // suasnutri_admin: sem permissão em nenhuma tabela clínica
  adminAuth: ReturnType<typeof createAdminAuthService>;
  now?: () => Date;
}

/**
 * Painel do dono (v0). Toda chamada exige sessão de super-admin válida (senha + 2FA)
 * e só lê tabelas de conta, cobrança e contadores. Ações administrativas são auditadas.
 */
export function createAdminPanel({ db, adminAuth, now = () => new Date() }: Deps) {
  const guard = async (token: string) => (await adminAuth.validateSession(token))?.adminId ?? null;
  const audit = (adminId: string, action: string, targetAccountId?: string, details?: Prisma.InputJsonValue) =>
    db.adminAuditLog.create({ data: { adminId, action, targetAccountId, details, createdAt: now() } });

  async function rows(f: TenantFilters): Promise<TenantRow[]> {
    const accounts = await db.account.findMany({
      where: {
        ...(f.status && { status: f.status }),
        ...(f.plan && { subscription: { plan: { code: f.plan } } }),
        ...(f.q && { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { email: { contains: f.q, mode: 'insensitive' } }] }),
        ...((f.createdFrom || f.createdTo) && { createdAt: { gte: f.createdFrom, lte: f.createdTo } }),
        ...(f.inactiveSince && { OR: [{ lastAccessAt: null }, { lastAccessAt: { lt: f.inactiveSince } }] }),
      },
      include: { subscription: { include: { plan: true } }, usageCounters: { orderBy: { date: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
    // v0: faixa de pacientes aplicada em memória (volume pequeno); mover para SQL quando crescer
    return accounts
      .map((a) => {
        const c = a.usageCounters[0];
        return {
          id: a.id, name: a.name, email: a.email, plan: a.subscription?.plan.code ?? null, status: a.status,
          patientsTotal: c?.patientsTotal ?? 0, patientsActive: c?.patientsActive ?? 0, users: c?.users ?? 0,
          createdAt: a.createdAt, lastAccessAt: a.lastAccessAt, countersDate: c?.date ?? null,
        };
      })
      .filter((r) => !f.patientBand || inBand(r.patientsTotal, f.patientBand));
  }

  async function listTenants(token: string, filters: TenantFilters = {}) {
    if (!(await guard(token))) return UNAUTH;
    return { ok: true as const, tenants: await rows(filters) };
  }

  const HEADER = ['id', 'nome', 'email', 'plano', 'status', 'pacientes_total', 'pacientes_ativos', 'usuarios', 'cadastro', 'ultimo_acesso'];
  async function exportTenantsCsv(token: string, filters: TenantFilters = {}) {
    const adminId = await guard(token);
    if (!adminId) return UNAUTH;
    const list = await rows(filters);
    const lines = [HEADER.join(',')].concat(
      list.map((r) => [r.id, r.name, r.email, r.plan, r.status, r.patientsTotal, r.patientsActive, r.users, r.createdAt, r.lastAccessAt].map(csvCell).join(',')),
    );
    await audit(adminId, 'TENANTS_EXPORTED', undefined, { rows: list.length });
    return { ok: true as const, csv: lines.join('\n') + '\n', rows: list.length };
  }

  async function getTenantDetail(token: string, accountId: string) {
    const adminId = await guard(token);
    if (!adminId) return UNAUTH;
    const a = await db.account.findUnique({
      where: { id: accountId },
      include: {
        subscription: { include: { plan: true } },
        usageCounters: { orderBy: { date: 'desc' }, take: 1 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!a) return { ok: false as const, reason: 'not_found' as const };
    await audit(adminId, 'TENANT_VIEWED', accountId);
    const c = a.usageCounters[0];
    return {
      ok: true as const,
      account: {
        id: a.id, name: a.name, email: a.email, phone: a.phone, crn: a.crn, city: a.city, status: a.status,
        trialEndsAt: a.trialEndsAt, createdAt: a.createdAt, lastAccessAt: a.lastAccessAt,
      },
      subscription: a.subscription && {
        plan: a.subscription.plan.code, status: a.subscription.status, priceCents: a.subscription.priceCents,
        currentPeriodEnd: a.subscription.currentPeriodEnd, graceEndsAt: a.subscription.graceEndsAt,
        patientLimit: a.subscription.plan.patientLimit, userLimit: a.subscription.plan.userLimit,
      },
      usage: c && {
        date: c.date, patientsTotal: c.patientsTotal, patientsActive: c.patientsActive, users: c.users, storageBytes: Number(c.storageBytes),
        percentOfPatientLimit: a.subscription?.plan.patientLimit ? Math.round((c.patientsTotal / a.subscription.plan.patientLimit) * 100) : null,
      },
      invoices: a.invoices.map((i) => ({ id: i.id, amountCents: i.amountCents, status: i.status, paidAt: i.paidAt, createdAt: i.createdAt })),
      timeline: a.events.map((e) => ({ kind: e.kind, details: e.details, createdAt: e.createdAt })),
    };
  }

  // ───────────── Ativação e suspensão (sempre auditadas) ─────────────
  async function suspendAccount(token: string, accountId: string, reason: string, sourceIp = 'unknown') {
    const adminId = await guard(token);
    if (!adminId) return UNAUTH;
    if (!reason?.trim()) return { ok: false as const, reason: 'reason_required' as const };
    const r = await db.account.updateMany({ where: { id: accountId, status: { not: 'SUSPENDED' } }, data: { status: 'SUSPENDED' } });
    if (r.count !== 1) return { ok: false as const, reason: 'not_applicable' as const };
    await db.tenantEvent.create({ data: { accountId, kind: 'SUSPENDED', details: { reason }, createdAt: now() } });
    await audit(adminId, 'ACCOUNT_SUSPENDED', accountId, { reason, sourceIp: auditOrigin(sourceIp) });
    return { ok: true as const };
  }

  async function reactivateAccount(token: string, accountId: string, sourceIp = 'unknown') {
    const adminId = await guard(token);
    if (!adminId) return UNAUTH;
    const a = await db.account.findUnique({ where: { id: accountId }, include: { subscription: true } });
    if (!a || a.status !== 'SUSPENDED') return { ok: false as const, reason: 'not_applicable' as const };
    const back = a.subscription && ['ACTIVE', 'PAST_DUE', 'TRIAL'].includes(a.subscription.status) ? a.subscription.status : 'TRIAL';
    await db.account.update({ where: { id: accountId }, data: { status: back } });
    await db.tenantEvent.create({ data: { accountId, kind: 'REACTIVATED', details: { status: back }, createdAt: now() } });
    await audit(adminId, 'ACCOUNT_REACTIVATED', accountId, { status: back, sourceIp: auditOrigin(sourceIp) });
    return { ok: true as const, status: back };
  }

  async function extendTrial(token: string, accountId: string, days: number) {
    const adminId = await guard(token);
    if (!adminId) return UNAUTH;
    if (!Number.isInteger(days) || days < 1 || days > 60) return { ok: false as const, reason: 'invalid_days' as const };
    const a = await db.account.findUnique({ where: { id: accountId } });
    if (!a || a.status !== 'TRIAL') return { ok: false as const, reason: 'not_applicable' as const };
    const base = a.trialEndsAt && a.trialEndsAt > now() ? a.trialEndsAt : now();
    const trialEndsAt = new Date(base.getTime() + days * 86_400_000);
    await db.account.update({ where: { id: accountId }, data: { trialEndsAt } });
    await db.tenantEvent.create({ data: { accountId, kind: 'TRIAL_EXTENDED', details: { days }, createdAt: now() } });
    await audit(adminId, 'TRIAL_EXTENDED', accountId, { days });
    return { ok: true as const, trialEndsAt };
  }

  return { listTenants, exportTenantsCsv, getTenantDetail, suspendAccount, reactivateAccount, extendTrial };
}
