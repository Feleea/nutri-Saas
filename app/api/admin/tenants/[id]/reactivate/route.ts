import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'admin',
  handler: async ({ adminToken, params, ip }) => {
    const r = await ctx().panel.reactivateAccount(adminToken!, params.id, ip);
    return r.ok ? { ok: true, status: r.status } : failFrom(r.reason);
  },
});
