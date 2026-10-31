import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import Link from 'next/link';
import TenantManagementLinks from '@/app/_components/TenantManagementLinks';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

const MODE: Record<string, string> = {
  FULL: 'Acesso completo',
  NO_NEW_PATIENTS: 'Novos cadastros bloqueados (regularize o pagamento). Seus dados continuam acessíveis.',
  READ_ONLY: 'Somente leitura. Seus dados continuam acessíveis e exportáveis.',
};
const ACCOUNT_STATUS: Record<string, string> = {
  TRIAL: 'Em período de teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento pendente',
  SUSPENDED: 'Suspensa',
  CANCELED: 'Cancelada',
};
const formatDate = (date: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
const formatMoney = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const formatLocalDate = (date: string) => {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

export default async function Painel() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');

  const titular = session.role === 'TITULAR';
  const dashboard = titular ? await ctx().billing.loadDashboardState(session) : null;
  const ownerState = dashboard?.ok ? dashboard : null;
  const now = new Date();
  const [patients, upcoming, notices, finance] = await Promise.all([
    ownerState ? ctx().patients.dashboardCounts(session, ownerState.plan?.activePatientDays ?? 90) : Promise.resolve(null),
    ctx().agenda.upcoming(session, now, new Date(now.getTime() + 7 * 86_400_000)),
    titular ? ctx().notices.list(session) : Promise.resolve([]),
    titular ? ctx().finance.list(session) : Promise.resolve(null),
  ]);
  const patientCounts = patients?.ok ? patients : null;
  const appointments = upcoming.ok ? upcoming : null;
  const financeSummary = finance?.ok ? finance.summary : null;
  const patientLimit = ownerState?.plan?.patientLimit ?? null;
  const canAddPatient = ownerState?.mode === 'FULL' && patientCounts !== null
    && (patientLimit === null || patientCounts.patientsUsed < patientLimit);

  return (
    <main>
      <TenantManagementLinks owner={titular} />
      <h1>Painel</h1>
      {ownerState && (
        <>
          <section className="card">
            <h2>Conta e plano</h2>
            <p><strong>Situação:</strong> <span className="badge">{ACCOUNT_STATUS[ownerState.accountStatus] ?? ownerState.accountStatus}</span></p>
            <p><strong>Plano:</strong> {ownerState.plan?.name ?? ownerState.plan?.code ?? 'Nenhum plano vinculado'}</p>
            {ownerState.accountStatus === 'TRIAL' && ownerState.trialEndsAt && <p><strong>Período de teste até:</strong> {formatDate(ownerState.trialEndsAt)}</p>}
            {ownerState.accountStatus === 'PAST_DUE' && ownerState.graceEndsAt && <p><strong>Carência até:</strong> {formatDate(ownerState.graceEndsAt)}</p>}
            {ownerState.accountStatus === 'ACTIVE' && ownerState.currentPeriodEnd && <p><strong>Período atual até:</strong> {formatDate(ownerState.currentPeriodEnd)}</p>}
            <p className="muted">{MODE[ownerState.mode]}</p>
          </section>

          <section className="card">
            <h2>Pacientes</h2>
            {patientCounts ? (
              <>
                <p><strong>Total de cadastros:</strong> {patientCounts.patientsTotal} <span className="muted">(inclui arquivados)</span></p>
                <p><strong>Ativos na janela do plano ({ownerState.plan?.activePatientDays ?? 90} dias):</strong> {patientCounts.patientsActive}</p>
                <p>
                  <strong>Uso do limite:</strong> {patientCounts.patientsUsed}
                  {patientLimit !== null
                    ? ` de ${patientLimit} (${Math.round(patientCounts.patientsUsed / patientLimit * 100)}%)`
                    : ' — sem limite'}
                </p>
              </>
            ) : <p>Não foi possível carregar os indicadores de pacientes.</p>}
            <Link className="btn secondary" href="/pacientes">Ver pacientes</Link>{' '}
            {canAddPatient
              ? <Link className="btn" href="/pacientes/novo">Cadastrar paciente</Link>
              : <p className="muted">Novos cadastros indisponíveis no momento; verifique a situação da conta e o limite do plano.</p>}
          </section>
        </>
      )}

      {titular && (
        <section className="card">
          <h2>Financeiro deste mês</h2>
          {financeSummary ? (
            <>
              <p><strong>Recebido:</strong> {formatMoney(financeSummary.receivedCents)}</p>
              <p><strong>Pendente:</strong> {formatMoney(financeSummary.pendingCents)}</p>
            </>
          ) : <p>Não foi possível carregar o resumo financeiro.</p>}
          <Link className="btn secondary" href="/financeiro">Ver financeiro</Link>
        </section>
      )}

      <section className="card">
        <h2>Próximas consultas</h2>
        {appointments ? (
          <>
            <p><strong>Nos próximos 7 dias:</strong> {appointments.total}</p>
            {appointments.items.length ? (
              <ul>
                {appointments.items.slice(0, 3).map((appointment) => (
                  <li key={appointment.id}>
                    <Link href={`/agenda?day=${appointment.local.date}`}>
                      {formatLocalDate(appointment.local.date)} às {appointment.local.time} — {appointment.patient.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nenhuma consulta agendada para os próximos 7 dias.</p>}
          </>
        ) : <p>Não foi possível carregar a agenda.</p>}
        <Link className="btn" href="/agenda">Ver agenda</Link>{' '}
        <Link className="btn secondary" href="/agenda/novo">Marcar consulta</Link>
      </section>

      {notices.map((n) => <div key={n.id} className="card"><p className="error" role="alert">{n.message}</p></div>)}
      {session.role !== 'SECRETARIA' && (
        <p>
          {!titular && <><Link className="btn secondary" href="/pacientes">Pacientes</Link>{' '}</>}
          <Link className="btn secondary" href="/anamnese">Modelos de anamnese</Link>
        </p>
      )}
      <LogoutButton />
    </main>
  );
}
