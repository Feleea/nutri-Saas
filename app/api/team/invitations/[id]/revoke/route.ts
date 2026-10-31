import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'team.manage',
  handler: async ({ session, params }) =>
    (await ctx().team.revokeInvite(session!, params.id)) ? reply({ ok: true }) : failFrom('not_found'),
});
