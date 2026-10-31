import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

import { parseTenantFilters } from '@/src/server/filters';

export const GET = defineRoute({
  auth: 'admin',
  handler: async ({ req, adminToken }) => {
    const sp = new URL(req.url).searchParams;
    const r = await ctx().panel.exportTenantsCsv(adminToken!, parseTenantFilters((k) => sp.get(k)));
    if (!r.ok) return failFrom(r.reason);
    return new Response(r.csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tenants.csv"', 'cache-control': 'no-store' },
    });
  },
});
