import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'admin',
  handler: async ({ adminToken }) => {
    await ctx().adminAuth.logout(adminToken!);
    return reply({ ok: true }, { cookies: [cookie(ADMIN_COOKIE, '', { clear: true })] });
  },
});
