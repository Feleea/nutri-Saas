import type { AccountStatus } from '@prisma/client';
import type { PatientBand, TenantFilters } from '../admin/panel';

const STATUSES: AccountStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'];
const BANDS: PatientBand[] = ['0-30', '31-100', '101-300', '300+'];

/** Converte parâmetros de URL em filtros do painel, ignorando valores inválidos. */
export function parseTenantFilters(get: (k: string) => string | null | undefined, now = new Date()): TenantFilters {
  const f: TenantFilters = {};
  const q = get('q')?.trim();
  if (q) f.q = q.slice(0, 100);
  const plan = get('plan')?.trim();
  if (plan) f.plan = plan.slice(0, 60);
  const status = get('status');
  if (status && (STATUSES as string[]).includes(status)) f.status = status as AccountStatus;
  const band = get('band');
  if (band && (BANDS as string[]).includes(band)) f.patientBand = band as PatientBand;
  const days = Number(get('inactiveDays'));
  if (Number.isInteger(days) && days > 0 && days <= 3650) f.inactiveSince = new Date(now.getTime() - days * 86_400_000);
  return f;
}
