import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute<undefined, { token: string }>({
  auth: 'session',
  action: 'patient.export',
  handler: async ({ session, params }) => {
    const r = await ctx().lgpd.downloadExport(session!, params.token);
    if (!r.ok) return failFrom(r.reason);
    return new Response(r.content, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${r.filename}"`,
        'cache-control': 'no-store',
      },
    });
  },
});
