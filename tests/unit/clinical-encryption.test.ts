import { describe, expect, it } from 'vitest';
import {
  decryptClinicalData, encryptClinicalData, newTenantDataKey, unwrapTenantDataKey, wrapTenantDataKey,
} from '../../src/clinical/encryption';

describe('cifra de dados clínicos por tenant', () => {
  it('faz round-trip com chave aleatória distinta por tenant', () => {
    const keyA = newTenantDataKey();
    const keyB = newTenantDataKey();
    const value = { motivo: 'Alergia alimentar confidencial' };
    const cipher = encryptClinicalData('tenant-a', 'record-a', 'ANAMNESIS_ANSWERS', value, keyA);

    expect(keyA.equals(keyB)).toBe(false);
    expect(decryptClinicalData('tenant-a', 'record-a', 'ANAMNESIS_ANSWERS', cipher, keyA)).toEqual(value);
    expect(() => decryptClinicalData('tenant-a', 'record-a', 'ANAMNESIS_ANSWERS', cipher, keyB)).toThrow();
  });

  it('vincula chave embrulhada e ciphertext ao tenant, registro e tipo de dado', () => {
    const keyA = newTenantDataKey();
    const keyB = newTenantDataKey();
    const wrappedA = wrapTenantDataKey('tenant-a', keyA);
    const wrappedB = wrapTenantDataKey('tenant-b', keyB);
    const cipher = encryptClinicalData('tenant-a', 'record-a', 'ANTHROPOMETRY', { weightKg: 73.2 }, keyA);

    expect(unwrapTenantDataKey('tenant-a', wrappedA).equals(keyA)).toBe(true);
    expect(() => unwrapTenantDataKey('tenant-a', wrappedB)).toThrow();
    expect(() => decryptClinicalData('tenant-b', 'record-a', 'ANTHROPOMETRY', cipher, keyA)).toThrow();
    expect(() => decryptClinicalData('tenant-a', 'record-b', 'ANTHROPOMETRY', cipher, keyA)).toThrow();
    expect(() => decryptClinicalData('tenant-a', 'record-a', 'ANAMNESIS_ANSWERS', cipher, keyA)).toThrow();
  });

  it('rejeita ciphertext adulterado', () => {
    const key = newTenantDataKey();
    const cipher = encryptClinicalData('tenant-a', 'record-a', 'ANAMNESIS_ANSWERS', { x: 'segredo' }, key);
    const parts = cipher.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;

    expect(() => decryptClinicalData('tenant-a', 'record-a', 'ANAMNESIS_ANSWERS', parts.join('.'), key)).toThrow();
  });

  it('cifra snapshots de plano vinculando tenant, plano e número da versão', () => {
    const key = newTenantDataKey();
    const payload = { title: 'Plano protegido', meals: [{ name: 'Café', time: '08:00' }] };
    const cipher = encryptClinicalData('tenant-a', 'plan-a:v2:version-id', 'PLAN_VERSION', payload, key);

    expect(decryptClinicalData('tenant-a', 'plan-a:v2:version-id', 'PLAN_VERSION', cipher, key)).toEqual(payload);
    expect(() => decryptClinicalData('tenant-b', 'plan-a:v2:version-id', 'PLAN_VERSION', cipher, key)).toThrow();
    expect(() => decryptClinicalData('tenant-a', 'plan-a:v3:version-id', 'PLAN_VERSION', cipher, key)).toThrow();
    const parts = cipher.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    const altered = parts.join('.');
    expect(() => decryptClinicalData('tenant-a', 'plan-a:v2:version-id', 'PLAN_VERSION', altered, key)).toThrow();
  });
});
