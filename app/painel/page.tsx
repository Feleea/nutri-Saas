import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import Link from 'next/link';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

const MODE: Record<string, string> = {
  FULL: 'Acesso completo',
  NO_NEW_PATIENTS: 'Novos cadastros bloqueados (regularize o pagamento). Seus dados continuam acessíveis.',
  READ_ONLY: 'Somente leitura. Seus dados continuam acessíveis e exportáveis.',
};

export default async function Painel() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  const s = await ctx().billing.loadAccessState(session.accountId);
  const notices = session.role === 'TITULAR' ? await ctx().notices.list(session) : [];
  return (
    <main>
      <h1>Painel</h1>
      <div className="card">
        <p><strong>Plano:</strong> {s.planCode ?? '—'} <span className="badge">{session.role.toLowerCase()}</span></p>
        <p><strong>Pacientes:</strong> {s.patientsTotal}{s.patientLimit ? ` de ${s.patientLimit}` : ''}</p>
        <p className="muted">{MODE[s.mode]}</p>
      </div>
      {notices.map((n) => <div key={n.id} className="card"><p className="error" role="alert">{n.message}</p></div>)}
      <p>
        <Link className="btn" href="/agenda">Agenda</Link>{' '}
        {session.role !== 'SECRETARIA' && <><Link className="btn secondary" href="/pacientes">Pacientes</Link>{' '}<Link className="btn secondary" href="/anamnese">Modelos de anamnese</Link></>}
      </p>
      <LogoutButton />
    </main>
  );
}
