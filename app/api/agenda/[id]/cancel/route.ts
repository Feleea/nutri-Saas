import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<{ reason: string }, { id: string }>({
  auth: 'session',
  action: 'agenda.write',
  body: z.object({ reason: z.string().max(300) }),
  handler: async ({ session, params, body }) => {
    const r = await ctx().agenda.cancel(session!, params.id, body.reason);
    return r.ok ? { ok: true } : failFrom(r.reason, { errors: r.errors });
  },
});
