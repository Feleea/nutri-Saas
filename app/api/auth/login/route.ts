import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'login', max: 10, windowSec: 900 },
  body: z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }),
  handler: async ({ body, ip }) => {
    const r = await ctx().auth.login(body.email, body.password, ip);
    if (r.ok) return reply({ accountId: r.accountId, role: r.role }, { cookies: [cookie(SESSION_COOKIE, r.token)] });
    if (r.reason === 'mfa_required') return reply({ mfa_required: true, challenge: r.challenge });
    if (r.reason === 'email_not_verified') return fail(403, 'email_not_verified');
    return fail(401, 'invalid_credentials'); // idêntico para senha errada, e-mail inexistente e conta bloqueada
  },
});
