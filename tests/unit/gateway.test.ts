import { describe, expect, it } from 'vitest';
import { HmacGateway, signBody } from '../../src/billing/gateway';

describe('gateway configuration', () => {
  it('allows the application context to initialize without a webhook secret but fails closed when billing uses it', () => {
    let secret = '';
    const gateway = new HmacGateway(() => secret);
    const body = '{"id":"evt_1"}';

    expect(() => gateway.verify(body, '')).toThrow('GATEWAY_WEBHOOK_SECRET ausente');
    expect(() => gateway.createCharge()).toThrow('GATEWAY_WEBHOOK_SECRET ausente');

    secret = 'configured-secret';
    expect(gateway.verify(body, signBody(secret, body))).toBe(true);
  });
});
