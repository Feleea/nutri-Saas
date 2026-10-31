import { z } from 'zod';
import { defineRoute, reply, failFrom } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'billing.read',
  handler: async ({ session, params }) => ((await ctx().notices.markRead(session!, params.id)) ? { ok: true } : failFrom('not_found')),
});
