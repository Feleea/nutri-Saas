import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute<undefined, { id: string }>({
  auth: 'admin',
  handler: async ({ adminToken, params }) => {
    const r = await ctx().panel.getTenantDetail(adminToken!, params.id);
    if (!r.ok) return failFrom(r.reason);
    const { ok: _ok, ...detail } = r;
    return detail;
  },
});
