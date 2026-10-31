import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, totpCode, verifyTotp, stepAt, generateRecoveryCodes, normalizeRecoveryCode } from '../../src/auth/totp';
import { encryptSecret, decryptSecret } from '../../src/crypto/secrets';

// Vetores oficiais da RFC 6238 (SHA-1, segredo ASCII "12345678901234567890"), truncados a 6 dígitos.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('US-AUT-04 · TOTP [unit]', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('reproduz o vetor RFC 6238 em t=%i', (t, expected) => {
    expect(totpCode(SECRET, t * 1000)).toBe(expected);
  });

  it('base32 é reversível', () => {
    const raw = Buffer.from('segredo-qualquer-123');
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  it('aceita ±1 passo e recusa fora da janela', () => {
    const t = 1_700_000_000_000;
    expect(verifyTotp(SECRET, totpCode(SECRET, t - 30_000), t, null)).toBe(stepAt(t) - 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, t + 30_000), t, null)).toBe(stepAt(t) + 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, t - 90_000), t, null)).toBeNull();
  });

  it('não aceita o mesmo passo duas vezes (anti-reuso)', () => {
    const t = 1_700_000_000_000;
    const step = verifyTotp(SECRET, totpCode(SECRET, t), t, null)!;
    expect(verifyTotp(SECRET, totpCode(SECRET, t), t, step)).toBeNull();
  });

  it('recusa formato inválido', () => {
    expect(verifyTotp(SECRET, '12345', Date.now(), null)).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef', Date.now(), null)).toBeNull();
  });

  it('códigos de recuperação: 10 únicos, formato xxxxx-xxxxx', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[a-z2-7]{5}-[a-z2-7]{5}$/.test(c))).toBe(true);
    expect(normalizeRecoveryCode(' ABCDE-fghij ')).toBe('abcdefghij');
  });
});

describe('Cifragem de segredos [unit][seg]', () => {
  it('cifra e decifra; o texto cifrado não contém o segredo', () => {
    const enc = encryptSecret(SECRET);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain(SECRET);
    expect(decryptSecret(enc)).toBe(SECRET);
  });

  it('dois cifrados do mesmo segredo diferem (IV aleatório)', () => {
    expect(encryptSecret(SECRET)).not.toBe(encryptSecret(SECRET));
  });

  it('adulteração é detectada', () => {
    const [v, iv, tag, data] = encryptSecret(SECRET).split('.');
    const bad = Buffer.from(data, 'base64');
    bad[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, bad.toString('base64')].join('.'))).toThrow();
  });
});
