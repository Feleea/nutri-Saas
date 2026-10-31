import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

export const GET = defineRoute({
  auth: 'session',
  action: 'foods.read',
  handler: async ({ req, session }) => {
    const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
    if (q.length < 1 || q.length > 100) return fail(400, 'validation', { issues: [{ path: 'q', message: 'entre 1 e 100 caracteres' }] });
    return { results: await ctx().foods.search(session!, q) };
  },
});
