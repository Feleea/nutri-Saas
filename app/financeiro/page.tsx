import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { can } from '@/src/server/permissions';
import { SESSION_COOKIE } from '@/src/server/web';
import { localParts } from '@/src/agenda/time';
import ChargeForm from './ChargeForm';
import ReceiveChargeButton from './ReceiveChargeButton';

export const dynamic = 'force-dynamic';

const METHODS: Record<string, string> = {
  PIX: 'PIX', CASH: 'Dinheiro', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', TRANSFER: 'Transferência', OTHER: 'Outro',
};

const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export default async function Finance({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (!can(session.role, 'finance.read')) return <main><p>Acesso restrito à equipe clínica.</p></main>;
  const { month } = await searchParams;
  const result = await ctx().finance.list(session, month);
  if (!result.ok) return <main><p>Mês inválido.</p></main>;
  const date = (value: Date | string | null) => value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: result.timezone }).format(new Date(value))
    : '—';

  return (
    <main>
      <p><Link href="/agenda">← Voltar à agenda</Link> · <Link href="/marca">Identidade visual</Link></p>
      <h1>Financeiro da clínica</h1>
      <form className="filters" method="get">
        <div><label htmlFor="month">Mês</label><input id="month" name="month" type="month" defaultValue={result.month} /></div>
        <button>Consultar</button>
      </form>
      <div className="finance-summary">
        <section className="card"><span className="muted">Recebido no mês</span><strong>{money(result.summary.receivedCents)}</strong></section>
        <section className="card"><span className="muted">Pendente no mês</span><strong>{money(result.summary.pendingCents)}</strong></section>
      </div>
      <ChargeForm today={localParts(new Date(), result.timezone).date} timezone={result.timezone} />
      <h2>Movimentações · {result.month}</h2>
      {result.charges.length === 0 ? <div className="card"><p>Nenhuma cobrança neste mês.</p></div> : (
        <div className="finance-table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Paciente</th><th>Descrição</th><th>Consulta</th><th>Pagamento</th><th>Status</th><th>Valor</th></tr></thead>
            <tbody>{result.charges.map((charge) => (
              <tr key={charge.id}>
                <td>{date(charge.status === 'PAID' ? charge.paidAt : charge.occurredAt)}</td>
                <td>{charge.patient.fullName}</td>
                <td>{charge.description}</td>
                <td>{date(charge.appointment?.startsAt ?? null)}</td>
                <td>{METHODS[charge.paymentMethod]}</td>
                <td><span className="badge">{charge.status === 'PAID' ? 'Recebido' : 'Pendente'}</span>
                  {charge.status === 'PENDING' && <ReceiveChargeButton id={charge.id} />}
                </td>
                <td>{money(charge.amountCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
