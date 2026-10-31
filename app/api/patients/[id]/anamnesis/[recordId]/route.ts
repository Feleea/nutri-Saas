import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { anamnesisPatchSchema, type AnamnesisPatch } from '@/src/clinical/validation';

type P = { id: string; recordId: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const r = await ctx().clinical.getAnamnesis(session!, params.id, params.recordId);
    if (!r.ok) return failFrom(r.reason);
    return { record: r.record };
  },
});

export const PATCH = defineRoute<AnamnesisPatch, P>({
  auth: 'session',
  action: 'patient.write',
  body: anamnesisPatchSchema,
  handler: async ({ session, params, body }) => {
    const r = await ctx().clinical.updateAnamnesis(session!, params.id, params.recordId, body);
    if (!r.ok) return failFrom(r.reason, { errors: 'errors' in r ? r.errors : undefined });
    return { record: r.record };
  },
});
