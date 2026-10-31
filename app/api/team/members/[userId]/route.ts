import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const DELETE = defineRoute<undefined, { userId: string }>({
  auth: 'session',
  action: 'team.manage',
  handler: async ({ session, params, ip }) => {
    const r = await ctx().team.removeMember(session!, params.userId, ip);
    return r.ok ? reply({ ok: true }) : failFrom(r.reason);
  },
});
