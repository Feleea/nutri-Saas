import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'patient.write',
  handler: async ({ session, params }) => {
    const r = await ctx().patients.archive(session!, params.id);
    if (r.ok) return { ok: true };
    const f = r as { reason: string; limit?: number | null; count?: number; upgrade?: true };
    return failFrom(f.reason, { limit: f.limit, count: f.count, upgrade: f.upgrade });
  },
});
