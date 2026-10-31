import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { ADMIN_COOKIE } from '@/src/server/web';
import TenantActions from './TenantActions';

export const dynamic = 'force-dynamic';

export default async function TenantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value ?? '';
  const r = await ctx().panel.getTenantDetail(token, id);
  if (!r.ok && r.reason === 'unauthorized') redirect('/admin/login');
  if (!r.ok) return <main><p>Cliente não encontrado.</p><Link href="/admin">Voltar</Link></main>;
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 16).replace('T', ' ') : '—');

  return (
    <main>
      <p><Link href="/admin">← Clientes</Link></p>
      <h1>{r.account.name} <span className="badge">{r.account.status}</span></h1>
      <div className="card">
        <p>{r.account.email} · {r.account.phone ?? 'sem telefone'} · CRN {r.account.crn ?? '—'} · {r.account.city ?? '—'}</p>
        <p className="muted">Cadastro {d(r.account.createdAt)} · último acesso {d(r.account.lastAccessAt)} · trial até {d(r.account.trialEndsAt)}</p>
      </div>
      <div className="card">
        <p><strong>Plano:</strong> {r.subscription?.plan ?? '—'} ({r.subscription?.status ?? '—'})</p>
        <p><strong>Uso:</strong> {r.usage ? `${r.usage.patientsTotal} pacientes (${r.usage.patientsActive} ativos), ${r.usage.users} usuário(s)${r.usage.percentOfPatientLimit !== null ? `, ${r.usage.percentOfPatientLimit}% do limite` : ''}` : 'sem contagem ainda'}</p>
      </div>
      <TenantActions id={id} status={r.account.status} />
      <h2>Faturas</h2>
      <table><thead><tr><th>Data</th><th>Valor</th><th>Status</th></tr></thead><tbody>
        {r.invoices.map((i) => <tr key={i.id}><td>{d(i.createdAt)}</td><td>R$ {(i.amountCents / 100).toFixed(2)}</td><td>{i.status}</td></tr>)}
      </tbody></table>
      <h2>Linha do tempo</h2>
      <table><thead><tr><th>Quando</th><th>Evento</th></tr></thead><tbody>
        {r.timeline.map((e, i) => <tr key={i}><td>{d(e.createdAt)}</td><td>{e.kind}</td></tr>)}
      </tbody></table>
    </main>
  );
}
