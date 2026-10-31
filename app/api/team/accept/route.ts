import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'invite-accept', max: 10, windowSec: 900 },
  body: z.object({
    token: z.string().min(10).max(200),
    userName: z.string().max(120).optional(),
    password: z.string().max(200).optional(),
    acceptTerms: z.boolean().optional(),
    acceptPrivacy: z.boolean().optional(),
    acceptDpa: z.boolean().optional(),
  }),
  handler: async ({ body, ip }) => {
    const { token, ...input } = body;
    const r = await ctx().team.acceptInvite(token, input, ip);
    return r.ok ? { accountId: r.accountId, role: r.role } : failFrom(r.reason);
  },
});
