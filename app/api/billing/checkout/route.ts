import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

// A conta vem SEMPRE da sessão; qualquer accountId enviado no corpo é descartado pelo schema.
export const POST = defineRoute({
  auth: 'session',
  action: 'billing.manage',
  body: z.object({ planCode: z.string().min(1).max(60), method: z.enum(['CARD', 'PIX', 'BOLETO']) }),
  handler: async ({ session, body }) => {
    const r = await ctx().billing.startCheckout(session!.accountId, body.planCode, body.method);
    return r.ok ? { gatewayRef: r.gatewayRef, amountCents: r.amountCents } : failFrom(r.reason);
  },
});
