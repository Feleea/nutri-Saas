import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'mfa', max: 10, windowSec: 900 },
  body: z.object({ challenge: z.string().min(10).max(200), code: z.string().min(6).max(32) }),
  handler: async ({ body }) => {
    const r = await ctx().auth.verifyMfa(body.challenge, body.code);
    if (r.ok) return reply({ accountId: r.accountId, role: r.role }, { cookies: [cookie(SESSION_COOKIE, r.token)] });
    return fail(401, 'invalid_credentials');
  },
});
