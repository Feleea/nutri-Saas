import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'agenda.read',
  handler: async ({ session, params }) => {
    const r = await ctx().agenda.get(session!, params.id);
    if (!r.ok) return failFrom(r.reason);
    return { appointment: r.appointment, history: r.history };
  },
});
