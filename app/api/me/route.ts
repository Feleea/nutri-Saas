import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'account.read',
  handler: async ({ session }) => {
    const s = await ctx().billing.loadAccessState(session!.accountId);
    return {
      userId: session!.userId,
      accountId: session!.accountId,
      role: session!.role,
      access: { mode: s.mode, plan: s.planCode, patientsTotal: s.patientsTotal, patientLimit: s.patientLimit, canAddPatient: s.canAddPatient },
    };
  },
});
