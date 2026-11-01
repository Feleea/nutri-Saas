import { z } from 'zod';
import { defineRoute, fail, reply } from '@/src/server/http';
import { prisma } from '@/src/db/tenant';
import { createPortalService, PORTAL_COOKIE } from '@/src/portal/service';
import { ctx } from '@/src/server/context';

const schema = z.object({ token: z.string().min(1).max(500) });

function portalCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PORTAL_COOKIE}=${encodeURIComponent(value)}; Path=/api/portal; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'portal-redeem', max: 8, windowSec: 900 },
  body: schema,
  handler: async ({ body }) => {
    const result = await createPortalService({ db: prisma, mailer: ctx().mailer }).redeem(body.token);
    if (!result.ok) return fail(400, 'invalid_portal_access');
    const maxAge = Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
    if (!maxAge) return fail(400, 'invalid_portal_access');
    return reply({ ok: true }, { cookies: [portalCookie(result.token, maxAge)] });
  },
});
