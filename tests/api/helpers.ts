import { randomInt } from 'node:crypto';
import type { MemoryMailer } from '../../src/auth/mailer';

type Handler = (req: Request, ctx?: { params: Promise<any> }) => Promise<Response>;

export interface Call {
  method?: string;
  url?: string;
  body?: unknown;
  raw?: string;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}

export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;

/** Chama o handler da rota diretamente com um Request (sem subir o Next). */
export async function call(route: Handler, o: Call = {}) {
  const method = o.method ?? 'POST';
  const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': o.ip ?? randomIp(), ...o.headers });
  if (o.cookie) headers.set('cookie', o.cookie);
  const body = o.raw ?? (o.body !== undefined && method !== 'GET' ? JSON.stringify(o.body) : undefined);
  const res = await route(new Request(o.url ?? 'http://localhost/api/x', { method, headers, body }), { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json, setCookies: res.headers.getSetCookie() };
}

export type Res = Awaited<ReturnType<typeof call>>;

/** "nome=valor" de um Set-Cookie, pronto para o cabeçalho Cookie. */
export function cookieOf(res: Res, name: string): string {
  const c = res.setCookies.find((x) => x.startsWith(`${name}=`));
  return c ? c.split(';')[0] : '';
}

export const mailer = () => (globalThis as { __mailer?: MemoryMailer }).__mailer!;

export function tokenFrom(to: string, kind: string): string {
  const m = [...mailer().outbox].reverse().find((x) => x.to === to && x.kind === kind);
  if (!m) throw new Error(`e-mail ${kind} para ${to} não encontrado`);
  return /token=([\w-]+)/.exec(m.text)![1];
}
