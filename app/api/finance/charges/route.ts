import { z } from 'zod';
import { prisma, withTenant } from '@/src/db/tenant';
import { zonedToUtc } from '@/src/agenda/time';
import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
});

export const POST = defineRoute({
  auth: 'session',
  action: 'finance.write',
  body: z.object({
    patientId: z.string().min(1).max(60),
    appointmentId: z.string().max(60).nullable().optional(),
    description: z.string().trim().min(1).max(160),
    amountCents: z.number().int().min(1).max(100_000_000),
    paymentMethod: z.enum(['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'OTHER']),
    status: z.enum(['PENDING', 'PAID']),
    occurredAt: dateOnly.optional(),
    paidAt: dateOnly.nullable().optional(),
  }).refine((body) => body.status !== 'PENDING' || !body.paidAt, {
    path: ['paidAt'], message: 'Data de recebimento só é válida para cobranças pagas.',
  }),
  handler: async ({ session, body }) => {
    const account = await withTenant(session!.accountId, (tx) =>
      tx.account.findUniqueOrThrow({ where: { id: session!.accountId }, select: { timezone: true } }), prisma);
    const atLocalNoon = (value?: string | null) => {
      if (!value) return null;
      const [year, month, day] = value.split('-').map(Number);
      return zonedToUtc(year, month, day, 12, 0, account.timezone);
    };
    const result = await ctx().finance.create(session!, {
      ...body,
      occurredAt: atLocalNoon(body.occurredAt) ?? undefined,
      paidAt: atLocalNoon(body.paidAt),
    });
    return result.ok ? reply({ charge: result.charge }, { status: 201 }) : failFrom(result.reason);
  },
});
