import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'signup', max: 10, windowSec: 900 },
  body: z.object({
    accountName: z.string().min(1).max(120),
    userName: z.string().min(1).max(120),
    email: z.string().max(254),
    password: z.string().min(1).max(200),
    acceptTerms: z.boolean(),
    acceptPrivacy: z.boolean(),
    acceptDpa: z.boolean(),
  }),
  handler: async ({ body }) => {
    const r = await ctx().auth.signup(body);
    // resposta neutra: não revela se o e-mail já existia
    return r.ok ? reply({ ok: true }, { status: 202 }) : fail(422, 'validation', { errors: r.errors });
  },
});
