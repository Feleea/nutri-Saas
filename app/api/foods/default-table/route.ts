import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: 'account.settings',
  body: z.object({ code: z.string().min(1).max(40) }),
  handler: async ({ session, body }) => {
    const r = await ctx().foods.setDefaultTable(session!, body.code);
    return r.ok ? { ok: true } : failFrom(r.reason);
  },
});
