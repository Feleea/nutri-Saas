import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'reset', max: 10, windowSec: 900 },
  body: z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }),
  handler: async ({ body }) => {
    const r = await ctx().auth.resetPassword(body.token, body.password);
    return r.ok ? reply({ ok: true }) : failFrom(r.reason);
  },
});
