import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<{ days: number }, { id: string }>({
  auth: 'admin',
  body: z.object({ days: z.number().int() }),
  handler: async ({ adminToken, params, body }) => {
    const r = await ctx().panel.extendTrial(adminToken!, params.id, body.days);
    return r.ok ? { ok: true, trialEndsAt: r.trialEndsAt } : failFrom(r.reason);
  },
});
