import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'account.read',
  handler: async ({ session }) => ctx().agenda.getSettings(session!),
});

export const POST = defineRoute({
  auth: 'session',
  action: 'account.settings',
  body: z.object({
    timezone: z.string().max(60).optional(),
    defaultAppointmentMinutes: z.number().int().optional(),
    reminderLeadHours: z.number().int().optional(),
  }),
  handler: async ({ session, body }) => {
    const r = await ctx().agenda.updateSettings(session!, body);
    return r.ok ? r.settings : failFrom(r.reason, { errors: r.errors });
  },
});
