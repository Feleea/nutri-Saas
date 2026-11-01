import { defineRoute, reply } from '@/src/server/http';
import { parseCookies } from '@/src/server/web';
import { prisma } from '@/src/db/tenant';
import { createPortalService, PORTAL_COOKIE } from '@/src/portal/service';
import { ctx } from '@/src/server/context';

function clearPortalCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PORTAL_COOKIE}=; Path=/api/portal; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export const POST = defineRoute({
  auth: 'public',
  rateLimit: { key: 'portal-logout', max: 30, windowSec: 60 },
  handler: async ({ req }) => {
    const token = parseCookies(req.headers.get('cookie'))[PORTAL_COOKIE];
    await createPortalService({ db: prisma, mailer: ctx().mailer }).logout(token);
    return reply({ ok: true }, { cookies: [clearPortalCookie()] });
  },
});
