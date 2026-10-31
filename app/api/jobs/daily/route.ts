import { defineRoute } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { refreshUsageCounters } from '@/src/db/admin';

// Rotina diária: contadores de uso (só contagens) e avisos de fim de carência.
export const POST = defineRoute({
  auth: 'job',
  handler: async () => {
    await refreshUsageCounters();
    const billing = await ctx().billing.runBillingJob();
    return { ok: true, ...billing };
  },
});
