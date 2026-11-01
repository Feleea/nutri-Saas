import { describe, expect, it } from 'vitest';
import { isUnverifiedEmailLoginEnabled } from '../../src/auth/service';

describe('temporary unverified-email login bypass', () => {
  it('is available only when explicitly enabled in development', () => {
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'development', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' })).toBe(true);
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'development', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'false' })).toBe(false);
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'test', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' })).toBe(false);
    expect(isUnverifiedEmailLoginEnabled({ NODE_ENV: 'production', ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true' })).toBe(false);
  });
});
