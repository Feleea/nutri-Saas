import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'forgot', max: 5, windowSec: 900 },
  body: z.object({ email: z.string().max(254) }),
  handler: async ({ body }) => {
    await ctx().auth.requestPasswordReset(body.email);
    return reply({ ok: true }, { status: 202 }); // sempre igual, exista ou não a conta
  },
});
