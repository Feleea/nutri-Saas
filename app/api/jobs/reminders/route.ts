import { z } from 'zod';
import { defineRoute, reply, fail, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

// Chamado por um agendador (cron) a cada poucos minutos, com o cabeçalho x-job-secret.
export const POST = defineRoute({
  auth: 'job',
  handler: async () => ({ ok: true, ...(await ctx().reminders.run()) }),
});
