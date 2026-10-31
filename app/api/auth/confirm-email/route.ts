import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'confirm-email', max: 20, windowSec: 900 },
  body: z.object({ token: z.string().min(10).max(200) }),
  handler: async ({ body }) => ((await ctx().auth.confirmEmail(body.token)) ? reply({ ok: true }) : failFrom('invalid_token')),
});
