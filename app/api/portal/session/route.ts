import { defineRoute, fail } from '@/src/server/http';
import { parseCookies } from '@/src/server/web';
import { ctx } from '@/src/server/context';
import { prisma } from '@/src/db/tenant';
import { createPortalService, PORTAL_COOKIE } from '@/src/portal/service';

export const GET = defineRoute({
  auth: 'public',
  rateLimit: { key: 'portal-read', max: 120, windowSec: 60 },
  handler: async ({ req }) => {
    const token = parseCookies(req.headers.get('cookie'))[PORTAL_COOKIE];
    const result = await createPortalService({ db: prisma, mailer: ctx().mailer }).content(token, ctx().mealPlans);
    if (!result.ok) return fail(401, 'invalid_portal_access');
    return result;
  },
});
