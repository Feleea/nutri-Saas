import { describe, it, expect } from 'vitest';
import { tzOffsetMs, zonedToUtc, localParts, parseLocal, dayBoundsUtc, isValidTimeZone } from '../../src/agenda/time';

const H = 3_600_000;

describe('US-AGE-01 · fuso horário da conta [unit]', () => {
  it('calcula o deslocamento de cada fuso, inclusive com horário de verão', () => {
    expect(tzOffsetMs(new Date('2026-10-22T12:00:00Z'), 'America/Sao_Paulo')).toBe(-3 * H);
    expect(tzOffsetMs(new Date('2026-10-22T12:00:00Z'), 'America/New_York')).toBe(-4 * H); // verão
    expect(tzOffsetMs(new Date('2026-12-22T12:00:00Z'), 'America/New_York')).toBe(-5 * H); // inverno
    expect(tzOffsetMs(new Date('2026-10-22T12:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * H);
  });

  it('hora de parede local → instante UTC', () => {
    expect(zonedToUtc(2026, 10, 22, 9, 0, 'America/Sao_Paulo').toISOString()).toBe('2026-10-22T12:00:00.000Z');
    expect(zonedToUtc(2026, 3, 7, 12, 0, 'America/New_York').toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(zonedToUtc(2026, 3, 8, 12, 0, 'America/New_York').toISOString()).toBe('2026-03-08T16:00:00.000Z'); // dia da virada
  });

  it('instante UTC → data e hora locais (virando o dia)', () => {
    expect(localParts(new Date('2026-10-22T02:30:00Z'), 'America/Sao_Paulo')).toEqual({ date: '2026-10-21', time: '23:30' });
    expect(localParts(new Date('2026-10-22T13:00:00Z'), 'Asia/Tokyo')).toEqual({ date: '2026-10-22', time: '22:00' });
  });

  it('recusa datas e horas inexistentes', () => {
    expect(parseLocal('2026-02-31', '10:00', 'America/Sao_Paulo')).toBeNull();
    expect(parseLocal('2026-10-22', '24:00', 'America/Sao_Paulo')).toBeNull();
    expect(parseLocal('22/10/2026', '10:00', 'America/Sao_Paulo')).toBeNull();
    expect(parseLocal('2026-10-22', '10:00', 'America/Sao_Paulo')?.toISOString()).toBe('2026-10-22T13:00:00.000Z');
  });

  it('limites do dia local em UTC (23 h no dia da virada do horário de verão)', () => {
    const b = dayBoundsUtc('2026-10-22', 'America/Sao_Paulo')!;
    expect([b.from.toISOString(), b.to.toISOString()]).toEqual(['2026-10-22T03:00:00.000Z', '2026-10-23T03:00:00.000Z']);
    const dst = dayBoundsUtc('2026-03-08', 'America/New_York')!;
    expect((dst.to.getTime() - dst.from.getTime()) / H).toBe(23);
    expect(dayBoundsUtc('2026-13-40', 'America/Sao_Paulo')).toBeNull();
  });

  it('valida nomes de fuso', () => {
    expect(isValidTimeZone('America/Bahia')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
