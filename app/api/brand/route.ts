import { z } from 'zod';
import { prisma, withTenant } from '@/src/db/tenant';
import { defineRoute, fail, failFrom } from '@/src/server/http';

const bodySchema = z.object({
  logoUrl: z.string().trim().max(2048).url().nullable(),
}).refine(({ logoUrl }) => !logoUrl || new URL(logoUrl).protocol === 'https:', {
  path: ['logoUrl'], message: 'Informe um endereço HTTPS.',
});

export const GET = defineRoute({
  auth: 'session',
  action: 'brand.read',
  handler: async ({ session }) => {
    const account = await withTenant(session!.accountId, (tx) =>
      tx.account.findUnique({ where: { id: session!.accountId }, select: { logoUrl: true } }), prisma);
    return { logoUrl: account?.logoUrl ?? null };
  },
});

export const POST = defineRoute({
  auth: 'session',
  action: 'brand.manage',
  body: bodySchema,
  handler: async ({ session, body }) => {
    if (body.logoUrl && new URL(body.logoUrl).protocol !== 'https:') return fail(422, 'invalid_logo_url');
    const account = await withTenant(session!.accountId, (tx) =>
      tx.account.update({ where: { id: session!.accountId }, data: { logoUrl: body.logoUrl } }), prisma);
    return { logoUrl: account.logoUrl };
  },
});
