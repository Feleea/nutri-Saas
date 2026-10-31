import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type GatewayEventType = 'PAYMENT_CONFIRMED' | 'PAYMENT_OVERDUE';

export interface GatewayEvent {
  eventId: string; // identificador único do evento no gateway (base da idempotência)
  type: GatewayEventType;
  accountId: string;
  amountCents?: number;
}

/** Porta para o gateway (Asaas, Iugu, Pagar.me...). Troque o adaptador sem tocar no serviço. */
export interface Gateway {
  verify(rawBody: string, signature: string): boolean;
  parse(rawBody: string): GatewayEvent;
  createCharge(input: { accountId: string; amountCents: number; method: 'CARD' | 'PIX' | 'BOLETO' }): { gatewayRef: string };
}

export const signBody = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex');

/** Adaptador genérico por HMAC-SHA256; também serve como sandbox nos testes. */
export class HmacGateway implements Gateway {
  constructor(private secret: string) {}

  verify(rawBody: string, signature: string): boolean {
    const a = Buffer.from(signBody(this.secret, rawBody));
    const b = Buffer.from(signature ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(rawBody: string): GatewayEvent {
    const e = JSON.parse(rawBody);
    if (!e?.id || !e?.accountId || !['PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE'].includes(e?.type)) {
      throw new Error('payload inválido');
    }
    return { eventId: String(e.id), type: e.type, accountId: String(e.accountId), amountCents: e.amountCents };
  }

  createCharge() {
    return { gatewayRef: `chg_${randomBytes(8).toString('hex')}` };
  }
}
