import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import ClinicalPanel from './ClinicalPanel';

export const dynamic = 'force-dynamic';

export default async function PacienteClinico({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  const result = await ctx().patients.get(session, id);
  if (!result.ok) return <main><p>Paciente não encontrado.</p><Link href="/pacientes">Voltar</Link></main>;
  return (
    <main>
      <p><Link href={`/pacientes/${id}`}>← Ficha do paciente</Link></p>
      <h1>Prontuário · {result.patient.fullName}</h1>
      {result.alerts.includes('consent_missing')
        ? <div className="card"><p className="error" role="alert">Registre ou renove o consentimento antes de consultar ou incluir informações clínicas.</p></div>
        : <ClinicalPanel patientId={id} />}
    </main>
  );
}
