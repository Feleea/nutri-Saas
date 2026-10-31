/** Fusos horários sem dependências: tudo é guardado em UTC e exibido no fuso da conta. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsOf = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
};

/** Diferença (em ms) entre o relógio local do fuso e o UTC no instante dado. */
export function tzOffsetMs(utc: Date, tz: string): number {
  const p = partsOf(utc, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(utc.getTime() / 1000) * 1000;
}

/** Hora de parede local → instante UTC (refina uma vez para cobrir mudanças de horário de verão). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localParts(d: Date, tz: string): { date: string; time: string } {
  const p = partsOf(d, tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "2026-10-22" + "09:30" no fuso → instante UTC. Datas inexistentes (ex.: 31/02) retornam null. */
export function parseLocal(date: string, time: string, tz: string): Date | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return zonedToUtc(y, mo, d, h, mi, tz);
}

/** Início (inclusive) e fim (exclusive) do dia local, em UTC. */
export function dayBoundsUtc(day: string, tz: string): { from: Date; to: Date } | null {
  const from = parseLocal(day, '00:00', tz);
  if (!from) return null;
  const [y, mo, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const to = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { from, to };
}
