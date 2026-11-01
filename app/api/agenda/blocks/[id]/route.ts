import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const DELETE = defineRoute<any, { id: string }>({
  auth: 'session',
  action: 'account.settings',
  handler: async ({ session, params }) => {
    const result = await ctx().agenda.deleteBlock(session!, params.id);
    return result.ok
      ? { blocks: result.blocks, professionals: result.professionals, timezone: (await ctx().agenda.getSettings(session!)).timezone }
      : failFrom(result.reason, { errors: result.errors });
  },
});
