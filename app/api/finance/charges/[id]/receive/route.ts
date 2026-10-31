import { z } from 'zod';
import { prisma, withTenant } from '@/src/db/tenant';
import { zonedToUtc } from '@/src/agenda/time';
import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const bodySchema = z.object({
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(({ paidAt }) => {
  if (!paidAt) return true;
  const [year, month, day] = paidAt.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
});

export const POST = defineRoute<{ paidAt?: string }, { id: string }>({
  auth: 'session',
  action: 'finance.write',
  body: bodySchema,
  handler: async ({ session, body, params }) => {
    const account = await withTenant(session!.accountId, (tx) =>
      tx.account.findUniqueOrThrow({ where: { id: session!.accountId }, select: { timezone: true } }), prisma);
    let paidAt: Date | undefined;
    if (body.paidAt) {
      const [year, month, day] = body.paidAt.split('-').map(Number);
      paidAt = zonedToUtc(year, month, day, 12, 0, account.timezone);
    }
    const result = await ctx().finance.receive(session!, params.id, paidAt);
    return result.ok ? { received: true } : failFrom(result.reason);
  },
});
