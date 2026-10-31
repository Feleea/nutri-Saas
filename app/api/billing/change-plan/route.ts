import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: 'billing.manage',
  body: z.object({ planCode: z.string().min(1).max(60) }),
  handler: async ({ session, body }) => {
    const r = await ctx().billing.changePlan(session!.accountId, body.planCode);
    return r.ok ? r : failFrom(r.reason);
  },
});
