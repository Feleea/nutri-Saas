import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { can } from '@/src/server/permissions';
import { SESSION_COOKIE } from '@/src/server/web';
import AgendaActions from './AgendaActions';
import TenantManagementLinks from '@/app/_components/TenantManagementLinks';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { SCHEDULED: 'Agendada', CONFIRMED: 'Confirmada', COMPLETED: 'Realizada', CANCELED: 'Cancelada', NO_SHOW: 'Faltou' };
const REMINDER: Record<string, string> = {
  PENDING: 'lembrete agendado', SENT: 'lembrete enviado', FAILED: 'lembrete falhou', CANCELED: '', SENDING: 'enviando lembrete',
  no_email: 'sem e-mail: lembrete não enviado', opt_out: 'paciente não quer lembretes', too_late: 'sem lembrete (consulta próxima)',
};

export default async function Agenda({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  const { day } = await searchParams;
  const r = await ctx().agenda.list(session, { day });
  if (!r.ok) return <main><p>Data inválida.</p><Link href="/agenda">Voltar</Link></main>;
  const current = r.items[0]?.local.date ?? day ?? '';

  return (
    <main>
      <TenantManagementLinks owner={session.role === 'TITULAR'} />
      <h1>Agenda</h1>
      <form className="filters" method="get">
        <div><label htmlFor="day">Dia</label><input id="day" name="day" type="date" defaultValue={current} /></div>
        <button>Ver</button>
      </form>
      <p>
        <Link className="btn" href="/agenda/novo">Marcar consulta</Link>{' '}
        {can(session.role, 'finance.read') && <><Link className="btn secondary" href="/financeiro">Financeiro</Link>{' '}<Link className="btn secondary" href="/marca">Identidade visual</Link>{' '}</>}
        <span className="muted">Horários no fuso {r.timezone}.</span>
      </p>
      {r.items.length === 0 ? (
        <div className="card"><p>Nenhuma consulta neste dia.</p></div>
      ) : (
        <table>
          <thead><tr><th>Horário</th><th>Paciente</th><th>Profissional</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {r.items.map((a) => (
              <tr key={a.id}>
                <td>{a.local.time}–{a.local.endTime}{a.online && ' 💻'}</td>
                <td>{a.patient.name}<br /><span className="muted">{a.reminder ? (REMINDER[a.reminder.reason ?? ''] ?? REMINDER[a.reminder.status]) : ''}</span></td>
                <td>{a.professional.name}</td>
                <td><span className="badge">{STATUS[a.status]}</span>{a.cancelReason && <><br /><span className="muted">{a.cancelReason}</span></>}</td>
                <td>{(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && <AgendaActions id={a.id} status={a.status} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
