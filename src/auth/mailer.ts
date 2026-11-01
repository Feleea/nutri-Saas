export interface Mail {
  to: string;
  kind: 'verify_email' | 'already_registered' | 'account_locked' | 'password_reset' | 'password_changed' | 'team_invite' | 'portal_invite' | 'plan_price_changed' | 'payment_overdue' | 'grace_ended' | 'limit_warning' | 'limit_reached' | 'appointment_reminder';
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Caixa de saída em memória (testes e staging com sandbox). */
export class MemoryMailer implements Mailer {
  outbox: Mail[] = [];
  async send(mail: Mail) {
    this.outbox.push(mail);
  }
}
