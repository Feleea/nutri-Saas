import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

type P = { id: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'foods.read',
  handler: async ({ session, params }) => ({ measures: await ctx().foods.getMeasures(session!, params.id) }),
});

export const POST = defineRoute<{ label: string; grams: number }, P>({
  auth: 'session',
  action: 'foods.write',
  body: z.object({ label: z.string().min(1).max(60), grams: z.number().positive().max(100000) }),
  handler: async ({ session, params, body }) => {
    const r = await ctx().foods.addMeasure(session!, params.id, body.label, body.grams);
    return r.ok ? reply({ ok: true }, { status: 201 }) : failFrom(r.reason);
  },
});
