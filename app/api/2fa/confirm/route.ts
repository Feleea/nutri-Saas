import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: '2fa.manage',
  rateLimit: { key: '2fa-confirm', max: 10, windowSec: 900 },
  body: z.object({ code: z.string().min(6).max(12) }),
  handler: async ({ session, body }) => {
    const codes = await ctx().auth.confirmTotpSetup(session!.userId, body.code);
    // códigos de recuperação: exibidos uma única vez
    return codes ? { recoveryCodes: codes } : fail(400, 'invalid_code');
  },
});
