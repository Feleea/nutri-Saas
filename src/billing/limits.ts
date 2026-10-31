/** Regras de acesso por situação de cobrança. Puras: o relógio entra como parâmetro. */
export type AccessMode = 'FULL' | 'NO_NEW_PATIENTS' | 'READ_ONLY';

export interface AccessInput {
  accountStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
}

/**
 * Nunca bloqueia o acesso do nutricionista aos dados dos próprios pacientes nem a exportação:
 * - trial vencido, suspensa ou cancelada → somente leitura (nada é apagado);
 * - atraso → acesso normal na carência; depois, só novos cadastros são bloqueados.
 */
export function accessMode(s: AccessInput, now: Date): AccessMode {
  switch (s.accountStatus) {
    case 'ACTIVE':
      return 'FULL';
    case 'TRIAL':
      return s.trialEndsAt && now >= s.trialEndsAt ? 'READ_ONLY' : 'FULL';
    case 'PAST_DUE':
      return s.graceEndsAt && now < s.graceEndsAt ? 'FULL' : 'NO_NEW_PATIENTS';
    default:
      return 'READ_ONLY';
  }
}

export function canAddPatient(mode: AccessMode, patientsTotal: number, patientLimit: number | null): boolean {
  return mode === 'FULL' && (patientLimit === null || patientsTotal < patientLimit);
}

/** Regra de "paciente ativo": atividade dentro da janela configurada no plano. */
export function isActivePatient(lastActivityAt: Date, windowDays: number, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() <= windowDays * 86_400_000;
}
