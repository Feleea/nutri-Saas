import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

type P = { id: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const r = await ctx().patients.get(session!, params.id);
    if (!r.ok) return failFrom(r.reason);
    const { ok: _ok, ...data } = r;
    return data;
  },
});

export const PATCH = defineRoute<any, P>({
  auth: 'session',
  action: 'patient.write',
  body: z.object({
    fullName: z.string().max(200).optional(),
    email: z.string().max(254).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    cpf: z.string().max(20).nullable().optional(),
    goal: z.string().max(400).nullable().optional(),
    tags: z.array(z.string().max(60)).max(20).nullable().optional(),
    remindersOptOut: z.boolean().optional(),
    confirmDuplicate: z.boolean().optional(),
  }),
  handler: async ({ session, params, body }) => {
    const r = await ctx().patients.update(session!, params.id, body);
    if (r.ok) return { patient: r.patient };
    const f = r as { reason: string; errors?: string[]; needsConfirm?: true };
    return failFrom(f.reason, { errors: f.errors, needsConfirm: f.needsConfirm });
  },
});
