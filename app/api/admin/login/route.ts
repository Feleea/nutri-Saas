import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'admin-login', max: 5, windowSec: 900 },
  body: z.object({
    email: z.string().max(254),
    password: z.string().min(1).max(200),
    code: z.string().regex(/^(?:\d{6})?$/, 'Informe o código temporário de 6 dígitos ou deixe vazio se o bypass local estiver habilitado.'),
  }),
  handler: async ({ body, ip }) => {
    const r = await ctx().adminAuth.login(body.email, body.password, body.code, ip);
    if (!r.ok) return fail(401, 'invalid_credentials');
    return reply({ ok: true }, { cookies: [cookie(ADMIN_COOKIE, r.token, { maxAge: 3600 })] });
  },
});
