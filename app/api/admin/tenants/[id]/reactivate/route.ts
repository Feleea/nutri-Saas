import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'admin',
  handler: async ({ adminToken, params }) => {
    const r = await ctx().panel.reactivateAccount(adminToken!, params.id);
    return r.ok ? { ok: true, status: r.status } : failFrom(r.reason);
  },
});
