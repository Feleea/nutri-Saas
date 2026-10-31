import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

// Avisos de cobrança e limites: só o titular.
export const GET = defineRoute({
  auth: 'session',
  action: 'billing.read',
  handler: async ({ session }) => ({ notices: await ctx().notices.list(session!) }),
});
