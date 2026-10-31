import { z } from 'zod';
import { defineRoute, fail } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: '2fa.manage',
  rateLimit: { key: '2fa-disable', max: 5, windowSec: 900 },
  body: z.object({ password: z.string().min(1).max(200), code: z.string().min(6).max(20) }),
  handler: async ({ session, body }) => {
    const disabled = await ctx().auth.disableTotp(session!.userId, body.password, body.code);
    return disabled ? { ok: true } : fail(400, 'invalid_2fa_confirmation');
  },
});
