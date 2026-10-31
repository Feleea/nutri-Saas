import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import PatientActions from './PatientActions';

export const dynamic = 'force-dynamic';

export default async function Paciente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  const r = await ctx().patients.get(session, id);
  if (!r.ok) return <main><p>Paciente não encontrado.</p><Link href="/pacientes">Voltar</Link></main>;
  const p = r.patient;
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '—');

  return (
    <main>
      <p><Link href="/pacientes">← Pacientes</Link></p>
      <h1>{p.fullName} {p.status === 'ARCHIVED' && <span className="badge">arquivado</span>}</h1>
      {p.status === 'ACTIVE' && !r.alerts.includes('consent_missing') && (
        <p className="patient-clinical-links">
          <Link className="btn secondary" href={`/pacientes/${id}/clinico`}>Anamnese e antropometria</Link>
          <Link className="btn secondary" href={`/pacientes/${id}/plano`}>Plano alimentar</Link>
        </p>
      )}
      {r.alerts.includes('consent_missing') && (
        <div className="card"><p className="error" role="alert">⚠ Consentimento LGPD deste paciente não registrado.</p></div>
      )}
      <div className="card">
        <p>{p.phone ?? '—'} · {p.email ?? '—'} · CPF {p.cpf ?? '—'}</p>
        <p><strong>Objetivo:</strong> {p.goal ?? '—'}</p>
        <p>{p.tags.map((t) => <span key={t} className="badge">{t}</span>)}</p>
        <p className="muted">Cadastro {d(p.createdAt)}. Consentimentos: {r.consents.length ? r.consents.map((c) => `v${c.version} em ${d(c.grantedAt)}${c.revokedAt ? ' (revogado)' : ''}`).join('; ') : 'nenhum'}.</p>
      </div>
      <PatientActions id={id} status={p.status} hasConsent={!r.alerts.includes('consent_missing')} />
    </main>
  );
}
