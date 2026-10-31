import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'patient.write',
  handler: async ({ session, params }) => {
    const r = await ctx().patients.revokeConsent(session!, params.id);
    return r.ok ? { revoked: r.revoked } : failFrom(r.reason);
  },
});
