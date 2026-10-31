import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const time = {
  startsAt: z.string().datetime({ offset: true }).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
};
const hasStart = (v: { startsAt?: string; date?: string; time?: string }) => !!v.startsAt || (!!v.date && !!v.time);
const toInput = <T extends { startsAt?: string }>(v: T) => ({ ...v, startsAt: v.startsAt ? new Date(v.startsAt) : undefined });
const failure = (r: any) => failFrom(r.reason, { errors: r.errors, needsConfirm: r.needsConfirm, conflicts: r.conflicts });

export const POST = defineRoute<any, { id: string }>({
  auth: 'session',
  action: 'agenda.write',
  body: z
    .object({ ...time, durationMinutes: z.number().int().optional(), confirmConflict: z.boolean().optional() })
    .refine(hasStart, { message: 'informe startsAt ou date + time' }),
  handler: async ({ session, params, body }) => {
    const r = await ctx().agenda.reschedule(session!, params.id, toInput(body));
    return r.ok ? { appointment: r.appointment } : failure(r);
  },
});
