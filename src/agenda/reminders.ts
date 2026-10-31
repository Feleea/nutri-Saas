import { PrismaClient } from '@prisma/client';
import { forTenant } from '../db/tenant';
import type { Mailer } from '../auth/mailer';
import { localParts } from './time';

export const REMINDER_CONFIG = { maxAttempts: 3, backoffMinutes: 5, staleClaimMinutes: 15, batch: 200 };
const MIN = 60_000;

export interface ReminderRunResult { sent: number; skipped: number; retried: number; failed: number; canceled: number }

interface Deps {
  db: PrismaClient; // suasnutri_app: cada conta é processada com o RLS do próprio tenant
  mailer: Mailer;
  now?: () => Date;
  config?: typeof REMINDER_CONFIG;
}

/**
 * Job de lembretes. Cada lembrete é "reivindicado" de forma atômica (PENDING → SENDING), então
 * execuções simultâneas não enviam duas vezes. O e-mail só leva data, hora e local/link: nada clínico.
 */
export function createReminderJob({ db, mailer, now = () => new Date(), config = REMINDER_CONFIG }: Deps) {
  async function processAccount(accountId: string, totals: ReminderRunResult) {
    const t = forTenant(accountId, undefined, db);
    const n = now();
    await t.reminder.updateMany({ where: { status: 'SENDING', claimedAt: { lt: new Date(n.getTime() - config.staleClaimMinutes * MIN) } }, data: { status: 'PENDING' } });
    const account = await t.account.findUniqueOrThrow({ where: { id: accountId } });
    const due = await t.reminder.findMany({
      where: { status: 'PENDING', sendAt: { lte: n } }, orderBy: { sendAt: 'asc' }, take: config.batch,
      include: { appointment: { include: { patient: { select: { fullName: true, email: true, remindersOptOut: true, status: true } }, professional: { select: { name: true } } } } },
    });

    for (const r of due) {
      const claim = await t.reminder.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'SENDING', claimedAt: n } });
      if (claim.count !== 1) continue; // outra execução pegou
      const a = r.appointment;
      const finish = async (status: 'SENT' | 'SKIPPED' | 'CANCELED' | 'FAILED' | 'PENDING', data: object = {}) => {
        await t.reminder.updateMany({ where: { id: r.id, status: 'SENDING' }, data: { status, ...data } });
      };

      if (!['SCHEDULED', 'CONFIRMED'].includes(a.status) || a.startsAt.getTime() <= n.getTime()) {
        await finish('CANCELED', { skipReason: 'appointment_changed' }); totals.canceled++; continue;
      }
      const skip = a.patient.remindersOptOut ? 'opt_out' : !a.patient.email ? 'no_email' : a.patient.status !== 'ACTIVE' ? 'patient_archived' : null;
      if (skip) { await finish('SKIPPED', { skipReason: skip }); totals.skipped++; continue; }

      const when = localParts(a.startsAt, account.timezone);
      const where = a.meetingUrl ? `Consulta online: ${a.meetingUrl}` : a.online ? 'Consulta online (o link será enviado pelo profissional).' : 'Consulta presencial.';
      try {
        await mailer.send({
          to: a.patient.email!, kind: 'appointment_reminder', subject: 'Lembrete da sua consulta',
          text: `Olá, ${a.patient.fullName.split(' ')[0]}! Lembrete da sua consulta com ${a.professional.name} em ${when.date.split('-').reverse().join('/')} às ${when.time} (${account.timezone}). ${where}`,
        });
        await finish('SENT', { sentAt: n, attempts: r.attempts + 1, lastError: null });
        totals.sent++;
      } catch (e) {
        const attempts = r.attempts + 1;
        const lastError = (e as Error)?.name ?? 'erro'; // só o tipo: nada de dados pessoais no registro
        if (attempts >= config.maxAttempts) { await finish('FAILED', { attempts, lastError }); totals.failed++; }
        else {
          await finish('PENDING', { attempts, lastError, sendAt: new Date(n.getTime() + config.backoffMinutes * MIN * 2 ** (attempts - 1)) });
          totals.retried++;
        }
      }
    }
  }

  async function run(): Promise<ReminderRunResult> {
    const totals: ReminderRunResult = { sent: 0, skipped: 0, retried: 0, failed: 0, canceled: 0 };
    const accounts = await db.$queryRaw<{ account_id: string }[]>`SELECT account_id FROM reminders_due_accounts(${now()}::timestamptz)`;
    for (const { account_id } of accounts) await processAccount(account_id, totals);
    return totals;
  }

  return { run };
}
