import { z } from 'zod';
import { createPatientImportService } from '@/src/patients/import';
import { prisma } from '@/src/db/tenant';
import { ctx } from '@/src/server/context';
import { defineRoute, failFrom, reply } from '@/src/server/http';

const importer = createPatientImportService({ db: prisma });

export const POST = defineRoute({
  auth: 'session',
  action: 'patient.write',
  body: z.object({
    action: z.enum(['preview', 'confirm']),
    csv: z.string().max(1_000_000),
    confirmDuplicates: z.boolean().optional(),
  }),
  handler: async ({ session, body }) => {
    if (body.action === 'preview') {
      const result = await importer.preview(session!, body.csv);
      if (!result.ok) return failFrom(result.reason);
      return result;
    }

    const result = await importer.confirm(session!, body.csv, body.confirmDuplicates === true);
    if (result.ok) {
      try {
        await ctx().patients.reconcileLimitNotices(session!.accountId);
      } catch (error) {
        console.error(`[api] patient import notice failed: ${(error as Error)?.name ?? 'erro'}`);
      }
      return reply(result, { status: 201 });
    }
    const { reason, ...extra } = result;
    return failFrom(reason, extra);
  },
});
