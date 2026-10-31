import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'team.manage',
  handler: async ({ session }) => {
    const result = await ctx().team.list(session!);
    return result.ok ? { members: result.members, invitations: result.invitations } : failFrom(result.reason);
  },
});
