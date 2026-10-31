import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<{ reason: string }, { id: string }>({
  auth: 'admin',
  body: z.object({ reason: z.string().min(1).max(500) }),
  handler: async ({ adminToken, params, body, ip }) => {
    const r = await ctx().panel.suspendAccount(adminToken!, params.id, body.reason, ip);
    return r.ok ? { ok: true } : failFrom(r.reason);
  },
});
