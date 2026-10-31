import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { templatePatchSchema, type TemplatePatch } from '@/src/clinical/validation';

type P = { id: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const r = await ctx().clinical.getTemplate(session!, params.id);
    if (!r.ok) return failFrom(r.reason);
    return { template: r.template };
  },
});

export const PATCH = defineRoute<TemplatePatch, P>({
  auth: 'session',
  action: 'patient.write',
  body: templatePatchSchema,
  handler: async ({ session, params, body }) => {
    const r = await ctx().clinical.updateTemplate(session!, params.id, body);
    if (!r.ok) return failFrom(r.reason);
    return { template: r.template, version: r.version };
  },
});
