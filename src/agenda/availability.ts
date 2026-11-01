import { localParts } from './time';

export interface AvailabilityRule {
  professionalUserId: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  active: boolean;
}

export function isWithinAvailability(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  rules: AvailabilityRule[],
  professionalUserId: string,
): boolean {
  if (!rules.length) return true;
  if (endsAt <= startsAt) return false;

  const firstMinute = Math.floor(startsAt.getTime() / 60_000) * 60_000;
  for (let instant = firstMinute; instant < endsAt.getTime(); instant += 60_000) {
    if (instant + 60_000 <= startsAt.getTime()) continue;
    const parts = localParts(new Date(instant), timezone);
    const [year, month, day] = parts.date.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const [hour, minute] = parts.time.split(':').map(Number);
    const wallMinute = hour * 60 + minute;
    const professionalRules = rules.filter(
      (rule) => rule.professionalUserId === professionalUserId && rule.weekday === weekday,
    );
    const applicable = professionalRules.length
      ? professionalRules
      : rules.filter((rule) => rule.professionalUserId === null && rule.weekday === weekday);
    if (!applicable.some((rule) => rule.active && rule.startMinute <= wallMinute && wallMinute < rule.endMinute)) {
      return false;
    }
  }
  return true;
}

export function validateAvailabilityRules(rules: AvailabilityRule[]): string[] {
  if (!Array.isArray(rules) || rules.length > 100) return ['rules_invalid'];
  return rules.some((rule) =>
    !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6 ||
    !Number.isInteger(rule.startMinute) || rule.startMinute < 0 || rule.startMinute >= 1440 ||
    !Number.isInteger(rule.endMinute) || rule.endMinute < 1 || rule.endMinute > 1440 ||
    rule.startMinute >= rule.endMinute || typeof rule.active !== 'boolean' ||
    (rule.professionalUserId !== null && typeof rule.professionalUserId !== 'string')
  ) ? ['rule_invalid'] : [];
}
