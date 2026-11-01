import { describe, expect, it } from 'vitest';
import { isWithinAvailability, validateAvailabilityRules, type AvailabilityRule } from '../../src/agenda/availability';

const rule = (overrides: Partial<AvailabilityRule> = {}): AvailabilityRule => ({
  professionalUserId: null, weekday: 1, startMinute: 540, endMinute: 1020, active: true, ...overrides,
});

describe('disponibilidade semanal da agenda', () => {
  it('mantém o comportamento sem regras e valida janelas sem cruzar a meia-noite', () => {
    expect(isWithinAvailability(new Date('2099-01-05T13:00:00Z'), new Date('2099-01-05T13:50:00Z'), 'America/Sao_Paulo', [], 'pro')).toBe(true);
    expect(validateAvailabilityRules([rule()])).toEqual([]);
    expect(validateAvailabilityRules([rule({ startMinute: 1380, endMinute: 60 })])).toEqual(['rule_invalid']);
  });

  it('aplica regras de conta e deixa regras profissionais específicas prevalecerem por dia', () => {
    const account = rule();
    const specific = rule({ professionalUserId: 'pro-1', startMinute: 840, endMinute: 900 });
    const start = new Date('2099-01-05T13:00:00Z');
    const end = new Date('2099-01-05T13:50:00Z');
    expect(isWithinAvailability(start, end, 'America/Sao_Paulo', [account], 'pro-1')).toBe(true);
    expect(isWithinAvailability(start, end, 'America/Sao_Paulo', [account, specific], 'pro-1')).toBe(false);
    expect(isWithinAvailability(start, end, 'America/Sao_Paulo', [account, specific], 'pro-2')).toBe(true);
    expect(isWithinAvailability(start, end, 'America/Sao_Paulo', [account, rule({ professionalUserId: 'pro-1', active: false })], 'pro-1')).toBe(false);
  });

  it('avalia cada minuto local ao atravessar mudanças de horário de verão', () => {
    const springForward = [new Date('2026-03-08T06:30:00Z'), new Date('2026-03-08T07:30:00Z')] as const;
    expect(isWithinAvailability(...springForward, 'America/New_York', [rule({ weekday: 0, startMinute: 60, endMinute: 240 })], 'pro')).toBe(true);
    expect(isWithinAvailability(...springForward, 'America/New_York', [rule({ weekday: 0, startMinute: 60, endMinute: 120 })], 'pro')).toBe(false);

    const repeatedHour = [new Date('2026-11-01T05:30:00Z'), new Date('2026-11-01T06:30:00Z')] as const;
    expect(isWithinAvailability(...repeatedHour, 'America/New_York', [rule({ weekday: 0, startMinute: 60, endMinute: 120 })], 'pro')).toBe(true);
  });
});
