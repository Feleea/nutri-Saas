import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const actual = await scrypt(pw, Buffer.from(s, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

/** Política: mínimo de 10 caracteres, com ao menos uma letra e um número. */
export function validatePassword(pw: string): boolean {
  return pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
