/**
 * Matriz de permissões (US-SEC-02). Toda rota autenticada declara UMA ação daqui;
 * o papel vem da sessão no servidor, nunca do cliente.
 */
export type Role = 'TITULAR' | 'PROFISSIONAL' | 'SECRETARIA';

const ALL: Role[] = ['TITULAR', 'PROFISSIONAL', 'SECRETARIA'];
const CLINICAL: Role[] = ['TITULAR', 'PROFISSIONAL'];
const OWNER_ONLY: Role[] = ['TITULAR'];

export const ACTIONS = {
  'account.read': ALL,
  'account.settings': OWNER_ONLY,
  '2fa.manage': ALL,
  'agenda.read': ALL,
  'agenda.write': ALL, // a secretária gerencia a agenda (sem acesso clínico)
  'team.manage': OWNER_ONLY,
  'billing.read': OWNER_ONLY,
  'billing.manage': OWNER_ONLY,
  'foods.read': CLINICAL,
  'foods.write': CLINICAL,
  'patient.read': CLINICAL,
  'patient.write': CLINICAL,
  'patient.export': CLINICAL,
  'patient.delete': CLINICAL,
} as const satisfies Record<string, Role[]>;

export type Action = keyof typeof ACTIONS;

export const can = (role: string, action: Action): boolean => (ACTIONS[action] as readonly string[]).includes(role);
