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

export const GET = defineRoute({
  auth: 'session',
  action: 'agenda.read',
  handler: async ({ req, session }) => {
    const sp = new URL(req.url).searchParams;
    const from = sp.get('from'), to = sp.get('to'), status = sp.get('status');
    const r = await ctx().agenda.list(session!, {
      day: sp.get('day') ?? undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      professionalId: sp.get('professionalId') ?? undefined,
      status: status && ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW'].includes(status) ? (status as any) : undefined,
    });
    return r.ok ? { timezone: r.timezone, items: r.items } : failure(r);
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'agenda.write',
  body: z
    .object({
      patientId: z.string().min(1).max(60),
      ...time,
      durationMinutes: z.number().int().optional(),
      professionalUserId: z.string().max(60).optional(),
      online: z.boolean().optional(),
      meetingUrl: z.string().max(500).nullable().optional(),
      confirmConflict: z.boolean().optional(),
    })
    .refine(hasStart, { message: 'informe startsAt ou date + time' }),
  handler: async ({ session, body }) => {
    const r = await ctx().agenda.create(session!, toInput(body));
    return r.ok ? reply({ appointment: r.appointment }, { status: 201 }) : failure(r);
  },
});
