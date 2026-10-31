import { describe, it, expect } from 'vitest';
import { accessMode, canAddPatient, isActivePatient } from '../../src/billing/limits';

const T0 = new Date('2026-10-01T12:00:00Z');
const plusDays = (d: number) => new Date(T0.getTime() + d * 86_400_000);

describe('US-PLN-04 · modo de acesso [unit]', () => {
  it('trial vigente: acesso total; trial vencido: somente leitura', () => {
    const acc = { accountStatus: 'TRIAL', trialEndsAt: plusDays(14), graceEndsAt: null } as const;
    expect(accessMode(acc, plusDays(13))).toBe('FULL');
    expect(accessMode(acc, plusDays(14))).toBe('READ_ONLY');
  });

  it('assinatura ativa: acesso total', () => {
    expect(accessMode({ accountStatus: 'ACTIVE', trialEndsAt: null, graceEndsAt: null }, T0)).toBe('FULL');
  });

  it('atraso: normal na carência; depois só bloqueia novos cadastros', () => {
    const acc = { accountStatus: 'PAST_DUE', trialEndsAt: null, graceEndsAt: plusDays(7) } as const;
    expect(accessMode(acc, plusDays(6))).toBe('FULL');
    expect(accessMode(acc, plusDays(7))).toBe('NO_NEW_PATIENTS');
  });

  it.each(['SUSPENDED', 'CANCELED'] as const)('%s: somente leitura', (accountStatus) => {
    expect(accessMode({ accountStatus, trialEndsAt: null, graceEndsAt: null }, T0)).toBe('READ_ONLY');
  });
});

describe('US-ADM-02 / US-PLN-03 · limite de pacientes [unit]', () => {
  it('permite até o limite e bloqueia a partir dele', () => {
    expect(canAddPatient('FULL', 29, 30)).toBe(true);
    expect(canAddPatient('FULL', 30, 30)).toBe(false);
    expect(canAddPatient('FULL', 999, null)).toBe(true);
  });
  it('excesso após downgrade bloqueia novos cadastros sem erro', () => {
    expect(canAddPatient('FULL', 12, 5)).toBe(false);
  });
  it('modos restritos nunca permitem novos cadastros', () => {
    expect(canAddPatient('NO_NEW_PATIENTS', 0, 30)).toBe(false);
    expect(canAddPatient('READ_ONLY', 0, 30)).toBe(false);
  });
});

describe('US-PLN-01 · regra de paciente ativo configurável [unit]', () => {
  it('respeita a janela em dias, inclusive na borda', () => {
    expect(isActivePatient(plusDays(-90), 90, T0)).toBe(true);
    expect(isActivePatient(plusDays(-91), 90, T0)).toBe(false);
    expect(isActivePatient(plusDays(-10), 5, T0)).toBe(false);
  });
});
