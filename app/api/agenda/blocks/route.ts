import { z } from 'zod';
import { defineRoute, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { parseLocal } from '@/src/agenda/time';

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const GET = defineRoute({
  auth: 'session',
  action: 'account.settings',
  handler: async ({ session }) => {
    const result = await ctx().agenda.getAvailabilitySettings(session!);
    return result.ok ? { blocks: result.blocks, professionals: result.professionals, timezone: (await ctx().agenda.getSettings(session!)).timezone } : failFrom(result.reason);
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'account.settings',
  body: z.object({
    startDate: localDate,
    startTime: localTime,
    endDate: localDate,
    endTime: localTime,
    professionalUserId: z.string().max(60).nullable().optional(),
    reason: z.string().max(200).nullable().optional(),
  }),
  handler: async ({ session, body }) => {
    const timezone = (await ctx().agenda.getSettings(session!)).timezone;
    const startsAt = parseLocal(body.startDate, body.startTime, timezone);
    const endsAt = parseLocal(body.endDate, body.endTime, timezone);
    if (!startsAt || !endsAt) return failFrom('validation', { errors: ['block_time_invalid'] });
    const result = await ctx().agenda.createBlock(session!, { ...body, startsAt, endsAt });
    return result.ok
      ? { blocks: result.blocks, professionals: result.professionals, timezone: (await ctx().agenda.getSettings(session!)).timezone }
      : failFrom(result.reason, { errors: result.errors });
  },
});
