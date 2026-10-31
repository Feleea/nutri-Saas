import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { anthropometryBodySchema, type AnthropometryBody } from '@/src/clinical/validation';

type P = { id: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const r = await ctx().clinical.listAnthropometry(session!, params.id);
    if (!r.ok) return failFrom(r.reason);
    return { items: r.items, bmiClassification: r.bmiClassification };
  },
});

export const POST = defineRoute<AnthropometryBody, P>({
  auth: 'session',
  action: 'patient.write',
  body: anthropometryBodySchema,
  handler: async ({ session, params, body }) => {
    const r = await ctx().clinical.createAnthropometry(session!, params.id, body);
    return r.ok
      ? reply({ record: r.record, bmiClassification: r.bmiClassification }, { status: 201 })
      : failFrom(r.reason, { errors: 'errors' in r ? r.errors : undefined });
  },
});
