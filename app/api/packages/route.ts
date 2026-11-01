import { z } from 'zod';
import { prisma } from '@/src/db/tenant';
import { createPackagesService } from '@/src/packages/service';
import { defineRoute, fail, reply } from '@/src/server/http';

const packages = createPackagesService({ db: prisma });

const responseFor = (result: any) => {
  if (result.ok) return reply(result);
  const status = result.reason === 'forbidden' ? 403
    : result.reason === 'patient_not_found' ? 404
      : result.reason === 'validation' ? 422 : 400;
  return fail(status, result.reason);
};

export const GET = defineRoute({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ req, session }) => {
    const patientId = new URL(req.url).searchParams.get('patientId');
    if (!patientId) return fail(400, 'patient_id_required');
    return responseFor(await packages.list(session!, patientId));
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'patient.write',
  body: z.object({
    patientId: z.string().min(1).max(60),
    name: z.string().trim().min(1).max(120),
    totalSessions: z.number().int().min(1).max(1000),
    amountCents: z.number().int().min(1).max(100_000_000),
  }),
  handler: async ({ session, body }) => {
    const result = await packages.create(session!, body);
    return result.ok ? reply({ package: result.package }, { status: 201 }) : responseFor(result);
  },
});
