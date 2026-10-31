import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'session',
  action: 'team.manage',
  body: z.object({ email: z.string().max(254), role: z.enum(['PROFISSIONAL', 'SECRETARIA']) }),
  handler: async ({ session, body }) => {
    const r = await ctx().team.invite(session!, body.email, body.role);
    return r.ok ? reply({ invitationId: r.invitationId }, { status: 201 }) : failFrom(r.reason);
  },
});
