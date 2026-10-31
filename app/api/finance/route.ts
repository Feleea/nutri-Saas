import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'finance.read',
  handler: async ({ req, session }) => {
    const month = new URL(req.url).searchParams.get('month') ?? undefined;
    const result = await ctx().finance.list(session!, month);
    return result.ok ? result : failFrom(result.reason);
  },
});
