import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'patient.export',
  handler: async ({ session, params }) => {
    const r = await ctx().lgpd.exportPatient(session!, params.id);
    return r.ok ? reply({ downloadUrl: `/api/exports/${r.token}`, expiresAt: r.expiresAt }, { status: 201 }) : failFrom(r.reason);
  },
});
