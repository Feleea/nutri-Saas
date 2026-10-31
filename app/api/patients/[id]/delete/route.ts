import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

type P = { id: string };

// Consulta prévia: informa se há prazo de guarda obrigatória antes de o usuário confirmar.
export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.delete',
  handler: async ({ session, params }) => {
    const r = await ctx().lgpd.requestDeletion(session!, params.id);
    return r.ok ? { blocked: r.blocked, retainUntil: r.retainUntil } : failFrom(r.reason);
  },
});

export const POST = defineRoute<{ mode: 'DELETE' | 'ANONYMIZE'; confirm: boolean }, P>({
  auth: 'session',
  action: 'patient.delete',
  body: z.object({ mode: z.enum(['DELETE', 'ANONYMIZE']), confirm: z.boolean() }),
  handler: async ({ session, params, body }) => {
    const r = await ctx().lgpd.executeDeletion(session!, params.id, body);
    if (r.ok) return { ok: true, purgeFailures: r.purgeFailures };
    return failFrom(r.reason, 'retainUntil' in r ? { retainUntil: r.retainUntil } : {});
  },
});
