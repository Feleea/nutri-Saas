import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../src/server/ratelimit';
import { ACTIONS, can, type Role } from '../../src/server/permissions';
import { csrfOk, cookie, parseCookies } from '../../src/server/web';
import { parseTenantFilters } from '../../src/server/filters';

describe('limite de requisições [unit]', () => {
  it('bloqueia após o máximo na janela e libera quando ela passa', () => {
    let t = 1_000_000;
    const rl = new RateLimiter(() => t);
    for (let i = 0; i < 3; i++) expect(rl.hit('k', 3, 60).allowed).toBe(true);
    const blocked = rl.hit('k', 3, 60);
    expect(blocked).toEqual({ allowed: false, retryAfterSec: 60 });
    t += 61_000;
    expect(rl.hit('k', 3, 60).allowed).toBe(true);
  });
  it('chaves independentes não interferem', () => {
    const rl = new RateLimiter(() => 0);
    rl.hit('a', 1, 60);
    expect(rl.hit('a', 1, 60).allowed).toBe(false);
    expect(rl.hit('b', 1, 60).allowed).toBe(true);
  });
});

describe('US-SEC-02 · matriz de permissões [unit]', () => {
  const roles: Role[] = ['TITULAR', 'PROFISSIONAL', 'SECRETARIA'];
  const expected: Record<string, Role[]> = {
    'team.manage': ['TITULAR'],
    'billing.manage': ['TITULAR'],
    'billing.read': ['TITULAR'],
    'account.settings': ['TITULAR'],
    'brand.read': ['TITULAR', 'PROFISSIONAL'],
    'brand.manage': ['TITULAR', 'PROFISSIONAL'],
    'finance.read': ['TITULAR', 'PROFISSIONAL'],
    'finance.write': ['TITULAR', 'PROFISSIONAL'],
    'foods.read': ['TITULAR', 'PROFISSIONAL'],
    'foods.write': ['TITULAR', 'PROFISSIONAL'],
    'patient.read': ['TITULAR', 'PROFISSIONAL'],
    'patient.write': ['TITULAR', 'PROFISSIONAL'],
    'patient.export': ['TITULAR', 'PROFISSIONAL'],
    'patient.delete': ['TITULAR', 'PROFISSIONAL'],
    'agenda.read': roles,
    'agenda.write': roles,
    'account.read': roles,
    '2fa.manage': roles,
  };
  it('cobre todas as ações declaradas, sem sobras', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(Object.keys(expected).sort());
  });
  it.each(Object.entries(expected))('%s: apenas os papéis previstos', (action, allowed) => {
    for (const r of roles) expect(can(r, action as keyof typeof ACTIONS)).toBe(allowed.includes(r));
  });
  it('a secretaria nunca acessa dados clínicos', () => {
    for (const a of ['patient.read', 'patient.write', 'patient.export', 'patient.delete', 'foods.write', 'brand.read', 'brand.manage', 'finance.read', 'finance.write'] as const) expect(can('SECRETARIA', a)).toBe(false);
  });
  it('papel desconhecido não tem acesso a nada', () => {
    for (const a of Object.keys(ACTIONS)) expect(can('SUPER', a as keyof typeof ACTIONS)).toBe(false);
  });
});

describe('web [unit]', () => {
  it('cookie de sessão é HttpOnly e SameSite=Lax; limpar zera a validade', () => {
    const c = cookie('sn_session', 'abc');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(cookie('sn_session', '', { clear: true })).toContain('Max-Age=0');
  });
  it('lê cookies', () => {
    expect(parseCookies('a=1; sn_session=xyz%3D')).toEqual({ a: '1', sn_session: 'xyz=' });
  });
  it('CSRF: exige JSON e origem do próprio app', () => {
    const mk = (h: Record<string, string>) => new Request('http://app.test/api/x', { method: 'POST', headers: { host: 'app.test', ...h } });
    expect(csrfOk(mk({ 'content-type': 'application/json' }))).toBe(true);
    expect(csrfOk(mk({ 'content-type': 'application/json', origin: 'http://app.test' }))).toBe(true);
    expect(csrfOk(mk({ 'content-type': 'text/plain' }))).toBe(false);
    expect(csrfOk(mk({ 'content-type': 'application/x-www-form-urlencoded' }))).toBe(false);
    expect(csrfOk(mk({ 'content-type': 'application/json', origin: 'https://evil.test' }))).toBe(false);
    expect(csrfOk(mk({ 'content-type': 'application/json', origin: 'null' }))).toBe(false);
  });
  it('filtros do painel ignoram valores inválidos', () => {
    const now = new Date('2026-10-21T00:00:00Z');
    const p = new URLSearchParams({ status: 'HACK', band: '31-100', plan: 'clinico-30', inactiveDays: '30', q: ' ana ' });
    const f = parseTenantFilters((k) => p.get(k), now);
    expect(f).toMatchObject({ patientBand: '31-100', plan: 'clinico-30', q: 'ana' });
    expect(f.status).toBeUndefined();
    expect(f.inactiveSince).toEqual(new Date('2026-09-21T00:00:00Z'));
  });
});
