import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: '2fa.manage',
  handler: async ({ session }) => {
    try {
      return await ctx().auth.beginTotpSetup(session!.userId);
    } catch {
      return fail(409, 'already_enabled');
    }
  },
});
