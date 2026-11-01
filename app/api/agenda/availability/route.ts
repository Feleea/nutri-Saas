import { z } from 'zod';
import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const rule = z.object({
  professionalUserId: z.string().max(60).nullable(),
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  active: z.boolean(),
});

export const GET = defineRoute({
  auth: 'session',
  action: 'account.settings',
  handler: async ({ session }) => {
    const result = await ctx().agenda.getAvailabilitySettings(session!);
    return result.ok ? { rules: result.rules, professionals: result.professionals } : failFrom(result.reason);
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'account.settings',
  body: z.object({ rules: z.array(rule).max(100) }),
  handler: async ({ session, body }) => {
    const result = await ctx().agenda.saveAvailabilityRules(session!, body.rules);
    return result.ok ? { rules: result.rules, professionals: result.professionals } : failFrom(result.reason, { errors: result.errors });
  },
});
