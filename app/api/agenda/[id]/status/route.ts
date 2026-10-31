import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<{ status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' }, { id: string }>({
  auth: 'session',
  action: 'agenda.write',
  body: z.object({ status: z.enum(['CONFIRMED', 'COMPLETED', 'NO_SHOW']) }),
  handler: async ({ session, params, body }) => {
    const r = await ctx().agenda.setStatus(session!, params.id, body.status);
    return r.ok ? { ok: true } : failFrom(r.reason);
  },
});
