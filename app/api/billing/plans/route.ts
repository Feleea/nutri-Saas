import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'billing.read',
  handler: async () => {
    const plans = await ctx().billing.listOfferedPlans();
    return plans.map((p) => ({ code: p.code, name: p.name, priceCents: p.priceCents, modules: p.modules, patientLimit: p.patientLimit, userLimit: p.userLimit, storageMb: p.storageMb }));
  },
});
