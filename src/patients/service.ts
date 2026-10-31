import { Prisma, PrismaClient } from '@prisma/client';
import { forTenant, withTenant } from '../db/tenant';
import type { SessionInfo } from '../auth/service';
import type { Mailer } from '../auth/mailer';
import { normalizeName } from '../foods/normalize';
import { accessMode } from '../billing/limits';
import type { PatientDataSource } from '../lgpd/service';
import { maskCpf, normalizeCpf, normalizeTags, validatePatientInput, type PatientInput } from './validate';

/** Versão do termo de consentimento do paciente (revisar com o jurídico). */
export const PATIENT_CONSENT_VERSION = '2026-10-v1';

type Tx = Prisma.TransactionClient;
const CLINICAL = new Set(['TITULAR', 'PROFISSIONAL']);
const FORBIDDEN = { ok: false as const, reason: 'forbidden' as const };
const NOT_FOUND = { ok: false as const, reason: 'not_found' as const };

export type CreateInput = PatientInput & { confirmDuplicate?: boolean; consent?: boolean };
export type UpdateInput = Partial<PatientInput> & { confirmDuplicate?: boolean };
export interface Failure {
  ok: false;
  reason: string;
  errors?: string[];
  needsConfirm?: true;
  limit?: number | null;
  count?: number;
  upgrade?: true;
}
interface Mail { to: string; kind: 'limit_warning' | 'limit_reached'; subject: string; text: string }

interface Deps {
  db: PrismaClient; // suasnutri_app
  mailer: Mailer;
  now?: () => Date;
}

/** Remove campos internos e mascara o CPF nas listagens. */
function dto(p: Prisma.PatientGetPayload<{}>, opts: { fullCpf?: boolean } = {}) {
  return {
    id: p.id, fullName: p.fullName, email: p.email, phone: p.phone, goal: p.goal, tags: p.tags, status: p.status,
    remindersOptOut: p.remindersOptOut, cpf: opts.fullCpf ? p.cpf : maskCpf(p.cpf), createdAt: p.createdAt, archivedAt: p.archivedAt,
  };
}

export function createPatientService({ db, mailer, now = () => new Date() }: Deps) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);

  /** Situação do plano lida AO VIVO (limite e contagem), não dos contadores diários. */
  async function entitlement(tx: Tx, accountId: string) {
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const sub = await tx.subscription.findUnique({ where: { accountId }, include: { plan: true } });
    const count = await tx.patient.count({ where: { status: 'ACTIVE' } });
    const mode = accessMode({ accountStatus: account.status, trialEndsAt: account.trialEndsAt, graceEndsAt: sub?.graceEndsAt ?? null }, now());
    return { mode, count, limit: sub?.plan.patientLimit ?? null, email: account.email };
  }

  /** Cria/remove os avisos de limite conforme o uso atual; devolve e-mails a enviar após o commit. */
  async function reconcileNotices(tx: Tx, accountId: string, count: number, limit: number | null, email: string): Promise<Mail[]> {
    const mails: Mail[] = [];
    const rules = [
      { kind: 'LIMIT_80', on: limit !== null && count * 5 >= limit * 4, mail: 'limit_warning' as const,
        subject: 'Você está chegando ao limite de pacientes',
        text: `Você usa ${count} de ${limit} pacientes do seu plano. Faça upgrade para não bloquear novos cadastros.` },
      { kind: 'LIMIT_100', on: limit !== null && count >= limit, mail: 'limit_reached' as const,
        subject: 'Limite de pacientes atingido',
        text: `Você atingiu ${count} de ${limit} pacientes. Novos cadastros estão bloqueados até o upgrade; o acesso aos pacientes existentes continua normal.` },
    ];
    for (const r of rules) {
      if (r.on) {
        const created = await tx.notice.createMany({ data: [{ accountId, kind: r.kind, message: r.text, createdAt: now() }], skipDuplicates: true });
        if (created.count === 1) mails.push({ to: email, kind: r.mail, subject: r.subject, text: r.text });
      } else {
        await tx.notice.deleteMany({ where: { kind: r.kind } });
      }
    }
    return mails;
  }
  const deliver = async (mails: Mail[]) => { for (const m of mails) await mailer.send(m); };
  const lock = (tx: Tx, accountId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`;

  // ───────────── US-PAC-01: cadastrar ─────────────
  async function create(s: SessionInfo, input: CreateInput): Promise<{ ok: true; patient: ReturnType<typeof dto> } | Failure | typeof FORBIDDEN> {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const errors = validatePatientInput(input, 'create');
    if (errors.length) return { ok: false, reason: 'validation', errors };

    const cpf = input.cpf?.trim() ? normalizeCpf(input.cpf) : null;
    let mails: Mail[] = [];
    const result = await withTenant(s.accountId, async (tx): Promise<{ ok: true; patient: Prisma.PatientGetPayload<{}> } | Failure> => {
      await lock(tx, s.accountId); // serializa cadastros do mesmo tenant: o limite não estoura em requisições simultâneas
      const ent = await entitlement(tx, s.accountId);
      if (ent.mode !== 'FULL') return { ok: false, reason: 'access_restricted', upgrade: true };
      if (ent.limit !== null && ent.count >= ent.limit) {
        mails = await reconcileNotices(tx, s.accountId, ent.count, ent.limit, ent.email);
        return { ok: false, reason: 'patient_limit', limit: ent.limit, count: ent.count, upgrade: true };
      }
      if (cpf && !input.confirmDuplicate && (await tx.patient.findFirst({ where: { cpf } }))) {
        return { ok: false, reason: 'duplicate_cpf', needsConfirm: true };
      }
      const p = await tx.patient.create({
        data: {
          accountId: s.accountId, fullName: input.fullName.trim(), normalizedName: normalizeName(input.fullName),
          email: input.email?.trim() || null, phone: input.phone?.trim() || null, cpf,
          goal: input.goal?.trim() || null, tags: normalizeTags(input.tags), createdAt: now(), lastActivityAt: now(),
        },
      });
      if (input.consent) {
        await tx.patientConsent.create({ data: { accountId: s.accountId, patientId: p.id, version: PATIENT_CONSENT_VERSION, grantedAt: now(), recordedByUserId: s.userId } });
      }
      await tx.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'PATIENT_CREATED', resource: 'Patient', resourceId: p.id, createdAt: now() } });
      mails = await reconcileNotices(tx, s.accountId, ent.count + 1, ent.limit, ent.email);
      return { ok: true, patient: p };
    }, db);
    await deliver(mails);
    return result.ok ? { ok: true, patient: dto(result.patient, { fullCpf: true }) } : result;
  }

  // ───────────── US-PAC-02: buscar e filtrar ─────────────
  async function list(s: SessionInfo, o: { q?: string; status?: 'ACTIVE' | 'ARCHIVED' | 'ALL'; tag?: string; limit?: number; cursor?: string } = {}) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const t = tenant(s);
    const limit = Math.min(100, Math.max(1, o.limit ?? 50));
    const status = o.status ?? 'ACTIVE';
    const q = o.q ? normalizeName(o.q) : '';
    const where: Prisma.PatientWhereInput = {
      ...(status !== 'ALL' && { status }),
      ...(q && { normalizedName: { contains: q } }),
      ...(o.tag && { tags: { has: normalizeName(o.tag) } }),
    };
    const rows = await t.patient.findMany({
      where, orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }], take: limit + 1,
      ...(o.cursor && { cursor: { id: o.cursor }, skip: 1 }),
      include: { consents: { where: { kind: 'DATA_PROCESSING', revokedAt: null }, select: { id: true }, take: 1 } },
    });
    const total = await t.patient.count({ where });
    const page = rows.slice(0, limit);
    return {
      ok: true as const, total, empty: total === 0, nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      items: page.map((p) => ({ ...dto(p), consentMissing: p.consents.length === 0 })),
    };
  }

  async function dashboardCounts(s: SessionInfo, activePatientDays: number) {
    if (s.role !== 'TITULAR') return FORBIDDEN;
    const t = tenant(s);
    const activeSince = new Date(now().getTime() - activePatientDays * 86_400_000);
    const [patientsTotal, patientsUsed, patientsActive] = await Promise.all([
      t.patient.count(),
      t.patient.count({ where: { status: 'ACTIVE' } }),
      t.patient.count({ where: { status: 'ACTIVE', lastActivityAt: { gte: activeSince } } }),
    ]);
    return { ok: true as const, patientsTotal, patientsUsed, patientsActive };
  }

  async function get(s: SessionInfo, id: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const t = tenant(s);
    const p = await t.patient.findUnique({ where: { id }, include: { consents: { orderBy: { grantedAt: 'desc' } } } });
    if (!p) return NOT_FOUND;
    await t.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'PATIENT_VIEW', resource: 'Patient', resourceId: id, createdAt: now() } });
    const consent = p.consents.find((c) => c.kind === 'DATA_PROCESSING' && !c.revokedAt) ?? null;
    return {
      ok: true as const,
      patient: dto(p, { fullCpf: true }),
      consents: p.consents.map((c) => ({ id: c.id, kind: c.kind, version: c.version, grantedAt: c.grantedAt, revokedAt: c.revokedAt })),
      alerts: consent ? [] : ['consent_missing'],
    };
  }

  // ───────────── US-PAC-03: editar, arquivar, restaurar ─────────────
  async function update(s: SessionInfo, id: string, patch: UpdateInput): Promise<{ ok: true; patient: ReturnType<typeof dto> } | Failure | typeof FORBIDDEN | typeof NOT_FOUND> {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const t = tenant(s);
    const cur = await t.patient.findUnique({ where: { id } });
    if (!cur) return NOT_FOUND;
    const errors = validatePatientInput(patch, 'update');
    const nextEmail = patch.email !== undefined ? patch.email?.trim() || null : cur.email;
    const nextPhone = patch.phone !== undefined ? patch.phone?.trim() || null : cur.phone;
    if (!nextEmail && !nextPhone) errors.push('contact_required');
    if (errors.length) return { ok: false, reason: 'validation', errors };

    const data: Prisma.PatientUpdateInput = { email: nextEmail, phone: nextPhone };
    if (patch.fullName !== undefined) { data.fullName = patch.fullName.trim(); data.normalizedName = normalizeName(patch.fullName); }
    if (patch.goal !== undefined) data.goal = patch.goal?.trim() || null;
    if (patch.tags !== undefined) data.tags = normalizeTags(patch.tags);
    if (patch.remindersOptOut !== undefined) data.remindersOptOut = patch.remindersOptOut;
    if (patch.cpf !== undefined) {
      const cpf = patch.cpf?.trim() ? normalizeCpf(patch.cpf) : null;
      if (cpf && cpf !== cur.cpf && !patch.confirmDuplicate && (await t.patient.findFirst({ where: { cpf, NOT: { id } } }))) {
        return { ok: false, reason: 'duplicate_cpf', needsConfirm: true };
      }
      data.cpf = cpf;
    }
    const p = await t.patient.update({ where: { id }, data });
    await t.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'PATIENT_UPDATED', resource: 'Patient', resourceId: id, createdAt: now() } });
    return { ok: true, patient: dto(p, { fullCpf: true }) };
  }

  /** Arquivar preserva todo o histórico e libera uma vaga do limite do plano. */
  async function archive(s: SessionInfo, id: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    let mails: Mail[] = [];
    const r = await withTenant(s.accountId, async (tx) => {
      await lock(tx, s.accountId);
      const p = await tx.patient.findUnique({ where: { id } });
      if (!p) return NOT_FOUND;
      if (p.status === 'ARCHIVED') return { ok: false as const, reason: 'already_archived' as const };
      await tx.patient.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: now() } });
      await tx.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'PATIENT_ARCHIVED', resource: 'Patient', resourceId: id, createdAt: now() } });
      const ent = await entitlement(tx, s.accountId);
      mails = await reconcileNotices(tx, s.accountId, ent.count, ent.limit, ent.email);
      return { ok: true as const };
    }, db);
    await deliver(mails);
    return r;
  }

  /** Restaurar volta a ocupar uma vaga: respeita o limite e o estado da assinatura. */
  async function restore(s: SessionInfo, id: string): Promise<{ ok: true } | Failure | typeof FORBIDDEN | typeof NOT_FOUND> {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    let mails: Mail[] = [];
    const r = await withTenant(s.accountId, async (tx): Promise<{ ok: true } | Failure | typeof NOT_FOUND> => {
      await lock(tx, s.accountId);
      const p = await tx.patient.findUnique({ where: { id } });
      if (!p) return NOT_FOUND;
      if (p.status !== 'ARCHIVED') return { ok: false, reason: 'not_archived' };
      const ent = await entitlement(tx, s.accountId);
      if (ent.mode !== 'FULL') return { ok: false, reason: 'access_restricted', upgrade: true };
      if (ent.limit !== null && ent.count >= ent.limit) return { ok: false, reason: 'patient_limit', limit: ent.limit, count: ent.count, upgrade: true };
      await tx.patient.update({ where: { id }, data: { status: 'ACTIVE', archivedAt: null, lastActivityAt: now() } });
      await tx.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'PATIENT_RESTORED', resource: 'Patient', resourceId: id, createdAt: now() } });
      mails = await reconcileNotices(tx, s.accountId, ent.count + 1, ent.limit, ent.email);
      return { ok: true };
    }, db);
    await deliver(mails);
    return r;
  }

  /** Após exclusões (LGPD) ou mudança de plano: recalcula os avisos de limite. */
  async function reconcileLimitNotices(accountId: string) {
    let mails: Mail[] = [];
    await withTenant(accountId, async (tx) => {
      const ent = await entitlement(tx, accountId);
      mails = await reconcileNotices(tx, accountId, ent.count, ent.limit, ent.email);
    }, db);
    await deliver(mails);
  }

  // ───────────── US-PAC-04: consentimento LGPD do paciente ─────────────
  async function recordConsent(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const t = tenant(s);
    if (!(await t.patient.findUnique({ where: { id: patientId } }))) return NOT_FOUND;
    const c = await t.patientConsent.create({
      data: { accountId: s.accountId, patientId, version: PATIENT_CONSENT_VERSION, grantedAt: now(), recordedByUserId: s.userId },
    });
    await t.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'CONSENT_RECORDED', resource: 'Patient', resourceId: patientId, createdAt: now() } });
    return { ok: true as const, consent: { id: c.id, version: c.version, grantedAt: c.grantedAt } };
  }

  async function revokeConsent(s: SessionInfo, patientId: string) {
    if (!CLINICAL.has(s.role)) return FORBIDDEN;
    const t = tenant(s);
    if (!(await t.patient.findUnique({ where: { id: patientId } }))) return NOT_FOUND;
    const r = await t.patientConsent.updateMany({ where: { patientId, revokedAt: null }, data: { revokedAt: now() } });
    if (r.count) await t.auditLog.create({ data: { accountId: s.accountId, actorUserId: s.userId, action: 'CONSENT_REVOKED', resource: 'Patient', resourceId: patientId, createdAt: now() } });
    return { ok: true as const, revoked: r.count };
  }

  return { create, list, dashboardCounts, get, update, archive, restore, reconcileLimitNotices, recordConsent, revokeConsent };
}

/** Os consentimentos entram na exportação LGPD do paciente. */
export const consentDataSource: PatientDataSource = {
  name: 'consentimentos',
  collect: (t, patientId) =>
    t.patientConsent.findMany({ where: { patientId }, select: { kind: true, version: true, grantedAt: true, revokedAt: true }, orderBy: { grantedAt: 'asc' } }),
};
