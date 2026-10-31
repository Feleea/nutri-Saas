import { defineRoute } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'foods.read',
  handler: async ({ session, params }) => ({
    measures: await ctx().foods.getMeasureOptions(session!, params.id),
  }),
});
