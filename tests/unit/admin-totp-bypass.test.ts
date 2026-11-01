import { describe, expect, it } from 'vitest';
import { isAdminTotpBypassEnabled } from '../../src/auth/admin';

describe('admin TOTP bypass', () => {
  it('only enables the bypass when explicitly configured in development', () => {
    expect(isAdminTotpBypassEnabled({
      NODE_ENV: 'development',
      ALLOW_ADMIN_LOGIN_WITHOUT_TOTP: 'true',
    })).toBe(true);
    expect(isAdminTotpBypassEnabled({
      NODE_ENV: 'development',
      ALLOW_ADMIN_LOGIN_WITHOUT_TOTP: 'false',
    })).toBe(false);
    expect(isAdminTotpBypassEnabled({
      NODE_ENV: 'production',
      ALLOW_ADMIN_LOGIN_WITHOUT_TOTP: 'true',
    })).toBe(false);
    expect(isAdminTotpBypassEnabled({
      NODE_ENV: 'test',
      ALLOW_ADMIN_LOGIN_WITHOUT_TOTP: 'true',
    })).toBe(false);
  });
});
