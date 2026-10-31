import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type ClinicalDataKind = 'ANAMNESIS_ANSWERS' | 'ANTHROPOMETRY' | 'PLAN_VERSION';

function masterKey(): Buffer {
  const configured = process.env.APP_ENCRYPTION_KEY;
  if (!configured) throw new Error('APP_ENCRYPTION_KEY ausente');
  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY deve ter 32 bytes (base64)');
  return key;
}

function aad(label: string, accountId: string, recordId: string, kind: ClinicalDataKind): Buffer {
  return Buffer.from(JSON.stringify(['suasnutri', label, 'v1', accountId, recordId, kind]), 'utf8');
}

function seal(plain: Buffer, key: Buffer, associatedData: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

function open(stored: string, key: Buffer, associatedData: Buffer): Buffer {
  const [version, iv, tag, ciphertext, ...extra] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined || extra.length) {
    throw new Error('ciphertext clínico inválido');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(associatedData);
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  } catch {
    throw new Error('ciphertext clínico inválido');
  }
}

export function newTenantDataKey(): Buffer {
  return randomBytes(32);
}

export function wrapTenantDataKey(accountId: string, dataKey: Buffer): string {
  if (dataKey.length !== 32) throw new Error('chave de dados inválida');
  const associatedData = Buffer.from(JSON.stringify(['suasnutri', 'tenant-data-key', 'v1', accountId]), 'utf8');
  return seal(dataKey, masterKey(), associatedData);
}

export function unwrapTenantDataKey(accountId: string, wrappedKey: string): Buffer {
  const associatedData = Buffer.from(JSON.stringify(['suasnutri', 'tenant-data-key', 'v1', accountId]), 'utf8');
  const dataKey = open(wrappedKey, masterKey(), associatedData);
  if (dataKey.length !== 32) throw new Error('chave de dados inválida');
  return dataKey;
}

export function encryptClinicalData(
  accountId: string,
  recordId: string,
  kind: ClinicalDataKind,
  value: unknown,
  dataKey: Buffer,
): string {
  if (dataKey.length !== 32) throw new Error('chave de dados inválida');
  return seal(
    Buffer.from(JSON.stringify(value), 'utf8'),
    dataKey,
    aad('clinical-data', accountId, recordId, kind),
  );
}

export function decryptClinicalData<T>(
  accountId: string,
  recordId: string,
  kind: ClinicalDataKind,
  ciphertext: string,
  dataKey: Buffer,
): T {
  if (dataKey.length !== 32) throw new Error('chave de dados inválida');
  return JSON.parse(open(
    ciphertext,
    dataKey,
    aad('clinical-data', accountId, recordId, kind),
  ).toString('utf8')) as T;
}
