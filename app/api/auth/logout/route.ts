import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: 'account.read',
  handler: async ({ sessionToken }) => {
    await ctx().auth.logout(sessionToken!);
    return reply({ ok: true }, { cookies: [cookie(SESSION_COOKIE, '', { clear: true })] });
  },
});
