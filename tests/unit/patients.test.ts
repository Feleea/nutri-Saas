import { describe, it, expect } from 'vitest';
import { isValidCpf, normalizeCpf, maskCpf, normalizeTags, validatePatientInput } from '../../src/patients/validate';

describe('US-PAC-01 · validação do cadastro [unit]', () => {
  it('CPF: aceita válidos (com ou sem máscara) e recusa dígito errado e sequências repetidas', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('normaliza CPF para dígitos e mascara na listagem', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(maskCpf('52998224725')).toBe('***.***.247-25');
    expect(maskCpf(null)).toBeNull();
  });
  it('etiquetas: sem acento, minúsculas, sem repetição', () => {
    expect(normalizeTags([' Gestante ', 'gestante', 'Diabéticos', ''])).toEqual(['gestante', 'diabeticos']);
    expect(normalizeTags(null)).toEqual([]);
  });
  it('exige nome e um contato (telefone ou e-mail)', () => {
    expect(validatePatientInput({ fullName: ' ' }, 'create')).toEqual(['name_required', 'contact_required']);
    expect(validatePatientInput({ fullName: 'Ana', phone: '(11) 99999-0000' }, 'create')).toEqual([]);
    expect(validatePatientInput({ fullName: 'Ana', email: 'ana@example.test' }, 'create')).toEqual([]);
  });
  it('recusa e-mail, telefone, CPF e etiquetas inválidos', () => {
    const e = validatePatientInput({ fullName: 'Ana', email: 'x', phone: '12', cpf: '123', tags: Array(11).fill('a') }, 'create');
    expect(e).toEqual(expect.arrayContaining(['email_invalid', 'phone_invalid', 'cpf_invalid', 'tags_invalid']));
  });
  it('na edição, só valida o que foi enviado', () => {
    expect(validatePatientInput({ goal: 'emagrecer' }, 'update')).toEqual([]);
    expect(validatePatientInput({ fullName: '' }, 'update')).toEqual(['name_required']);
  });
});
