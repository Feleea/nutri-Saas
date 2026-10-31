import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { anamnesisBodySchema, type AnamnesisBody } from '@/src/clinical/validation';

type P = { id: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const r = await ctx().clinical.listAnamneses(session!, params.id);
    if (!r.ok) return failFrom(r.reason);
    return { items: r.items };
  },
});

export const POST = defineRoute<AnamnesisBody, P>({
  auth: 'session',
  action: 'patient.write',
  body: anamnesisBodySchema,
  handler: async ({ session, params, body }) => {
    const r = await ctx().clinical.createAnamnesis(session!, params.id, body);
    return r.ok
      ? reply({ record: r.record }, { status: 201 })
      : failFrom(r.reason, { errors: 'errors' in r ? r.errors : undefined });
  },
});
