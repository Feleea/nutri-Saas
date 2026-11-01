import { prisma } from '@/src/db/tenant';
import { createPackagesService } from '@/src/packages/service';
import { defineRoute, fail } from '@/src/server/http';

const packages = createPackagesService({ db: prisma });

export const POST = defineRoute<undefined, { id: string }>({
  auth: 'session',
  action: 'patient.write',
  handler: async ({ session, params }) => {
    const result = await packages.cancel(session!, params.id);
    if (result.ok) return { canceled: true };
    const status = result.reason === 'forbidden' ? 403
      : result.reason === 'package_not_found' ? 404
        : result.reason === 'package_not_active' ? 409 : 400;
    return fail(status, result.reason);
  },
});
