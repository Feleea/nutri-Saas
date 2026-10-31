import { defineRoute, fail } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'finance.read',
  handler: async ({ req, session }) => {
    const params = new URL(req.url).searchParams;
    const patientId = params.get('patientId');
    if (patientId) return { appointments: await ctx().finance.appointmentsForPatient(session!, patientId) };
    const q = params.get('q')?.trim() ?? '';
    if (q.length < 1 || q.length > 100) return fail(400, 'validation', { issues: [{ path: 'q', message: 'entre 1 e 100 caracteres' }] });
    return { patients: await ctx().finance.searchPatients(session!, q) };
  },
});
