import { normalizeName } from '../foods/normalize';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const digits = (s: string) => s.replace(/\D/g, '');
export const normalizeCpf = digits;

/** CPF válido pelos dígitos verificadores (rejeita sequências repetidas). */
export function isValidCpf(raw: string): boolean {
  const d = normalizeCpf(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export const maskCpf = (cpf: string | null) => (cpf ? `***.***.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}` : null);

export function normalizeTags(tags?: string[] | null): string[] {
  return [...new Set((tags ?? []).map((t) => normalizeName(t)).filter(Boolean))];
}

export interface PatientInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  goal?: string | null;
  tags?: string[] | null;
  remindersOptOut?: boolean;
}

export function validatePatientInput(i: Partial<PatientInput>, mode: 'create' | 'update'): string[] {
  const e: string[] = [];
  if (mode === 'create' || i.fullName !== undefined) {
    if (!i.fullName?.trim()) e.push('name_required');
    else if (i.fullName.trim().length > 160) e.push('name_too_long');
  }
  const email = i.email?.trim();
  if (email && !EMAIL_RE.test(email)) e.push('email_invalid');
  const phone = i.phone?.trim();
  if (phone && !(digits(phone).length >= 8 && digits(phone).length <= 13)) e.push('phone_invalid');
  if (mode === 'create' && !email && !phone) e.push('contact_required');
  if (i.cpf?.trim() && !isValidCpf(i.cpf)) e.push('cpf_invalid');
  if (i.goal && i.goal.length > 300) e.push('goal_too_long');
  if (i.tags && (i.tags.length > 10 || i.tags.some((t) => t.trim().length > 30))) e.push('tags_invalid');
  return e;
}
