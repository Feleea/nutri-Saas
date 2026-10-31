import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { ADMIN_COOKIE } from '@/src/server/web';
import { parseTenantFilters } from '@/src/server/filters';

export const dynamic = 'force-dynamic';

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value ?? '';
  const sp = await searchParams;
  const r = await ctx().panel.listTenants(token, parseTenantFilters((k) => sp[k]));
  if (!r.ok) redirect('/admin/login');
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

  return (
    <main>
      <h1>Clientes</h1>
      <form className="filters" method="get">
        <div><label htmlFor="q">Busca</label><input id="q" name="q" defaultValue={sp.q} /></div>
        <div><label htmlFor="plan">Plano</label><input id="plan" name="plan" defaultValue={sp.plan} /></div>
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ''}>
            <option value="">Todos</option>
            {['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="band">Pacientes</label>
          <select id="band" name="band" defaultValue={sp.band ?? ''}>
            <option value="">Todas as faixas</option>
            {['0-30', '31-100', '101-300', '300+'].map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div><label htmlFor="inactiveDays">Sem acesso há (dias)</label><input id="inactiveDays" name="inactiveDays" inputMode="numeric" defaultValue={sp.inactiveDays} /></div>
        <button>Filtrar</button>
      </form>
      <p className="muted">{r.tenants.length} cliente(s). Somente dados de conta, cobrança e contagens: dados de pacientes nunca aparecem aqui. <a href={`/api/admin/tenants/export?${qs}`}>Exportar CSV</a></p>
      <table>
        <thead><tr><th>Cliente</th><th>Plano</th><th>Status</th><th>Pacientes (ativos)</th><th>Usuários</th><th>Cadastro</th><th>Último acesso</th></tr></thead>
        <tbody>
          {r.tenants.map((t) => (
            <tr key={t.id}>
              <td><Link href={`/admin/tenants/${t.id}`}>{t.name}</Link><br /><span className="muted">{t.email}</span></td>
              <td>{t.plan ?? '—'}</td><td><span className="badge">{t.status}</span></td>
              <td>{t.patientsTotal} ({t.patientsActive})</td><td>{t.users}</td><td>{fmt(t.createdAt)}</td><td>{fmt(t.lastAccessAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
