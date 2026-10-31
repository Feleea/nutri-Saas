import { MemoryMailer, type Mailer } from '../auth/mailer';

class ConsoleMailer implements Mailer {
  async send(m: { to: string; subject: string; text: string }) {
    console.log(`[mail:dev] para=${m.to} assunto="${m.subject}"\n${m.text}`);
  }
}

/** Em produção o provedor real precisa ser configurado: não existe envio "silencioso". */
export function createMailer(): Mailer {
  const driver = process.env.MAIL_DRIVER ?? (process.env.NODE_ENV === 'test' ? 'memory' : 'console');
  if (driver === 'memory') {
    const mem = new MemoryMailer();
    (globalThis as { __mailer?: MemoryMailer }).__mailer = mem; // lido pelos testes
    return mem;
  }
  if (driver === 'console' && process.env.NODE_ENV !== 'production') return new ConsoleMailer();
  throw new Error('Provedor de e-mail não configurado (MAIL_DRIVER)');
}
