import type { ZodType } from 'zod';
import type { SessionInfo } from '../auth/service';
import { ctx } from './context';
import { can, type Action } from './permissions';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_COOKIE, SESSION_COOKIE, clientIp, csrfOk, parseCookies } from './web';

export { ADMIN_COOKIE, SESSION_COOKIE, cookie } from './web';

export function reply(data: unknown, init: { status?: number; cookies?: string[]; headers?: Record<string, string> } = {}) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...init.headers });
  for (const c of init.cookies ?? []) h.append('set-cookie', c);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers: h });
}

export const fail = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  reply({ error: { code, ...extra } }, { status, headers });

/** Resultados dos serviços → status HTTP. */
const STATUS: Record<string, number> = {
  unauthorized: 401, forbidden: 403, not_found: 404, expired: 410,
  reason_required: 422, invalid_days: 422, validation: 422, invalid_email: 422, invalid_role: 422, invalid: 422,
  not_applicable: 409, user_limit: 409, already_member: 409, plan_unavailable: 409, no_subscription: 409,
  not_subscribed: 409, same_plan: 409, retention_period: 409,
  invalid_invite: 400, invalid_token: 400, confirmation_required: 422, cannot_remove_self: 409, cannot_remove_titular: 409,
  invalid_credentials: 401, password_weak: 422,
  conflict: 409, in_the_past: 422, patient_not_found: 404, not_editable: 409, professional_required: 422,
  duplicate_cpf: 409, patient_limit: 409, access_restricted: 403, already_archived: 409, not_archived: 409,
  consent_required: 409, patient_archived: 409, confirm_warnings: 422, ingredient_unavailable: 404,
};
export const failFrom = (reason: string, extra: Record<string, unknown> = {}) => fail(STATUS[reason] ?? 400, reason, extra);

export interface RouteMeta {
  auth: 'public' | 'session' | 'admin' | 'webhook' | 'job';
  action?: Action;
  rateLimit?: { key: string; max: number; windowSec: number };
}

export interface RouteCtx<B, P> {
  req: Request;
  body: B;
  params: P;
  ip: string;
  session: SessionInfo | null;
  sessionToken: string | null;
  adminId: string | null;
  adminToken: string | null;
}

interface Opts<B, P> extends RouteMeta {
  body?: ZodType<B, any, any>;
  handler: (c: RouteCtx<B, P>) => Promise<Response | object>;
}

/**
 * Toda rota passa por aqui, nesta ordem: CSRF → limite de requisições → autenticação → autorização
 * por ação → validação do corpo. Rota sem `auth` declarado não compila; o teste de inventário
 * confere que nenhuma rota escapa disso.
 */
export function defineRoute<B = undefined, P = Record<string, string>>(opts: Opts<B, P>) {
  const meta: RouteMeta = { auth: opts.auth, action: opts.action, rateLimit: opts.rateLimit };

  const fn = async (
    req: Request,
    routeCtx: { params: Promise<Record<string, string | string[] | undefined>> },
  ): Promise<Response> => {
    try {
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (mutating && opts.auth !== 'webhook' && opts.auth !== 'job' && !csrfOk(req)) return fail(403, 'csrf');

      if (opts.auth === 'job') {
        // chamado por agendador (cron), não por navegador: autentica por segredo compartilhado
        const secret = process.env.JOB_SECRET ?? '';
        const given = Buffer.from(req.headers.get('x-job-secret') ?? '');
        const want = Buffer.from(secret);
        if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) return fail(401, 'unauthorized');
      }

      const ip = clientIp(req);
      if (opts.rateLimit) {
        const r = ctx().limiter.hit(`${opts.rateLimit.key}:${ip}`, opts.rateLimit.max, opts.rateLimit.windowSec);
        if (!r.allowed) return fail(429, 'rate_limited', {}, { 'retry-after': String(r.retryAfterSec) });
      }

      const cookies = parseCookies(req.headers.get('cookie'));
      let session: SessionInfo | null = null;
      let adminId: string | null = null;
      const sessionToken = cookies[SESSION_COOKIE] ?? null;
      const adminToken = cookies[ADMIN_COOKIE] ?? null;

      if (opts.auth === 'session') {
        session = sessionToken ? await ctx().auth.validateSession(sessionToken) : null;
        if (!session) return fail(401, 'unauthorized');
        if (!opts.action || !can(session.role, opts.action)) return fail(403, 'forbidden');
      } else if (opts.auth === 'admin') {
        adminId = adminToken ? ((await ctx().adminAuth.validateSession(adminToken))?.adminId ?? null) : null;
        if (!adminId) return fail(401, 'unauthorized');
      }

      let body = undefined as B;
      if (opts.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return fail(400, 'invalid_json');
        }
        const parsed = opts.body.safeParse(raw);
        if (!parsed.success) {
          return fail(400, 'validation', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
        }
        body = parsed.data;
      }

      const params = (await routeCtx.params) as P;
      const out = await opts.handler({ req, body, params, ip, session, sessionToken, adminId, adminToken });
      return out instanceof Response ? out : reply(out);
    } catch (err) {
      // só o tipo do erro vai para o log: mensagens do banco podem conter dados pessoais
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} falhou: ${(err as Error)?.name ?? 'erro'}`);
      return fail(500, 'internal_error');
    }
  };

  return Object.assign(fn, { meta });
}
