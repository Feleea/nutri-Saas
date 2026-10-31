import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { templateBodySchema, type TemplateBody } from '@/src/clinical/validation';

export const GET = defineRoute({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session }) => {
    const r = await ctx().clinical.listTemplates(session!);
    if (!r.ok) return failFrom(r.reason);
    return { items: r.items };
  },
});

export const POST = defineRoute<TemplateBody>({
  auth: 'session',
  action: 'patient.write',
  body: templateBodySchema,
  handler: async ({ session, body }) => {
    const r = await ctx().clinical.createTemplate(session!, body);
    return r.ok ? reply({ template: r.template }, { status: 201 }) : failFrom(r.reason, { errors: 'errors' in r ? r.errors : undefined });
  },
});
