import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const fields = {
  fullName: z.string().max(200),
  email: z.string().max(254).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  cpf: z.string().max(20).nullable().optional(),
  goal: z.string().max(400).nullable().optional(),
  tags: z.array(z.string().max(60)).max(20).nullable().optional(),
};

export const GET = defineRoute({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ req, session }) => {
    const sp = new URL(req.url).searchParams;
    const status = sp.get('status');
    const limit = Number(sp.get('limit'));
    const r = await ctx().patients.list(session!, {
      q: sp.get('q') ?? undefined,
      tag: sp.get('tag') ?? undefined,
      cursor: sp.get('cursor') ?? undefined,
      status: status === 'ARCHIVED' || status === 'ALL' ? status : 'ACTIVE',
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    });
    if (!r.ok) return failFrom(r.reason);
    const { ok: _ok, ...page } = r;
    return page;
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'patient.write',
  body: z.object({ ...fields, confirmDuplicate: z.boolean().optional(), consent: z.boolean().optional() }),
  handler: async ({ session, body }) => {
    const r = await ctx().patients.create(session!, body);
    if (r.ok) return reply({ patient: r.patient }, { status: 201 });
    const f = r as { reason: string; errors?: string[]; needsConfirm?: true; limit?: number | null; count?: number; upgrade?: true };
    return failFrom(f.reason, { errors: f.errors, needsConfirm: f.needsConfirm, limit: f.limit, count: f.count, upgrade: f.upgrade });
  },
});
