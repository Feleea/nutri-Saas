import { isIP } from 'node:net';

export function auditOrigin(value = 'unknown'): string {
  const origin = value.trim();
  return isIP(origin) ? origin : 'unknown';
}
