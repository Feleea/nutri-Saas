import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

import { parseTenantFilters } from '@/src/server/filters';

export const GET = defineRoute({
  auth: 'admin',
  handler: async ({ req, adminToken }) => {
    const sp = new URL(req.url).searchParams;
    const r = await ctx().panel.listTenants(adminToken!, parseTenantFilters((k) => sp.get(k)));
    return r.ok ? { tenants: r.tenants } : failFrom(r.reason);
  },
});
