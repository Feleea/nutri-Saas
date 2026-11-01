import { z } from 'zod';
import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { prisma } from '@/src/db/tenant';
import { createPortalService } from '@/src/portal/service';

const bodySchema = z.object({
  patientId: z.string().min(1).max(64),
  approvedPlanIds: z.array(z.string().min(1).max(64)).max(30),
});

export const GET = defineRoute({
  auth: 'session',
  action: 'patient.read',
  rateLimit: { key: 'portal-invite-read', max: 60, windowSec: 60 },
  handler: async ({ req, session }) => {
    const patientId = new URL(req.url).searchParams.get('patientId') ?? '';
    if (!patientId || patientId.length > 64) return reply({ invitation: null });
    const result = await createPortalService({ db: prisma, mailer: ctx().mailer }).active(session!, patientId);
    return result.ok ? result : failFrom(result.reason);
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'patient.write',
  rateLimit: { key: 'portal-invite', max: 10, windowSec: 900 },
  body: bodySchema,
  handler: async ({ session, body }) => {
    const result = await createPortalService({ db: prisma, mailer: ctx().mailer }).invite(
      session!,
      body.patientId,
      body.approvedPlanIds,
    );
    return result.ok ? reply({ invitationId: result.invitationId, expiresAt: result.expiresAt }, { status: 201 }) : failFrom(result.reason);
  },
});
