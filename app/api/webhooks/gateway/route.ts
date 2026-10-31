import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

// Sem sessão: a autenticidade vem da assinatura HMAC do corpo bruto. Reentregas são idempotentes.
export const POST = defineRoute({
  auth: 'webhook',
  handler: async ({ req }) => {
    const raw = await req.text();
    const r = await ctx().billing.handleWebhook(raw, req.headers.get('x-signature') ?? '');
    if (!r.ok) return fail(r.reason === 'invalid_signature' ? 401 : 400, r.reason);
    return { ok: true, duplicate: r.duplicate };
  },
});
