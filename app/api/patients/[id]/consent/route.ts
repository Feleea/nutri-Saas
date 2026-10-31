import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'patient.write',
  handler: async ({ session, params }) => {
    const r = await ctx().patients.recordConsent(session!, params.id);
    return r.ok ? reply({ consent: r.consent }, { status: 201 }) : failFrom(r.reason);
  },
});
