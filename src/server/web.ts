export const SESSION_COOKIE = 'sn_session';
export const ADMIN_COOKIE = 'sn_admin';

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** HttpOnly (sem acesso por JavaScript), SameSite=Lax e Secure em produção. */
export function cookie(name: string, value: string, opts: { maxAge?: number; clear?: boolean } = {}): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${opts.clear ? '' : encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${opts.clear ? 0 : (opts.maxAge ?? 28_800)}`;
}

/**
 * Defesa de CSRF para requisições que alteram estado: exige JSON (um formulário HTML de outro site
 * não consegue enviar esse Content-Type) e, quando há cabeçalho Origin, que seja o do próprio app.
 */
export function csrfOk(req: Request, appOrigin = process.env.APP_ORIGIN): boolean {
  if (!/^application\/json/i.test(req.headers.get('content-type') ?? '')) return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin).host;
    const host = req.headers.get('host') ?? new URL(req.url).host;
    return o === host || (!!appOrigin && o === new URL(appOrigin).host);
  } catch {
    return false;
  }
}

export const clientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
