import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

// Busca mínima (id e nome) para marcar consultas: a secretária não precisa abrir a ficha do paciente.
export const GET = defineRoute({
  auth: 'session',
  action: 'agenda.read',
  handler: async ({ req, session }) => {
    const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
    if (q.length < 1 || q.length > 100) return fail(400, 'validation', { issues: [{ path: 'q', message: 'entre 1 e 100 caracteres' }] });
    return { patients: await ctx().agenda.searchPatients(session!, q) };
  },
});
