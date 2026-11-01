import { defineRoute, failFrom } from '@/src/server/http';
import { prisma } from '@/src/db/tenant';
import { createPortalService } from '@/src/portal/service';
import { ctx } from '@/src/server/context';

type P = { id: string };

export const POST = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.write',
  handler: async ({ session, params }) => {
    const result = await createPortalService({ db: prisma, mailer: ctx().mailer }).revoke(session!, params.id);
    return result.ok ? { revoked: true } : failFrom(result.reason);
  },
});
