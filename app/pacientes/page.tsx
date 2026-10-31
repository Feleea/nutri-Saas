import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';

export const dynamic = 'force-dynamic';

export default async function Pacientes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  const sp = await searchParams;
  const status = sp.status === 'ARCHIVED' || sp.status === 'ALL' ? sp.status : 'ACTIVE';
  const r = await ctx().patients.list(session, { q: sp.q, tag: sp.tag, status });
  if (!r.ok) return <main><p>Seu perfil não tem acesso à lista de pacientes.</p></main>;

  return (
    <main>
      <h1>Pacientes</h1>
      <form className="filters" method="get">
        <div><label htmlFor="q">Buscar por nome</label><input id="q" name="q" defaultValue={sp.q} /></div>
        <div><label htmlFor="tag">Etiqueta</label><input id="tag" name="tag" defaultValue={sp.tag} /></div>
        <div>
          <label htmlFor="status">Situação</label>
          <select id="status" name="status" defaultValue={status}>
            <option value="ACTIVE">Ativos</option><option value="ARCHIVED">Arquivados</option><option value="ALL">Todos</option>
          </select>
        </div>
        <button>Filtrar</button>
      </form>
      <p><Link className="btn" href="/pacientes/novo">Cadastrar paciente</Link></p>
      {r.empty ? (
        <div className="card">
          <p>Nenhum paciente encontrado{sp.q ? ` para “${sp.q}”` : ''}.</p>
          <Link className="btn secondary" href="/pacientes/novo">Cadastrar agora</Link>
        </div>
      ) : (
        <table>
          <thead><tr><th>Nome</th><th>Contato</th><th>Etiquetas</th><th></th></tr></thead>
          <tbody>
            {r.items.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/pacientes/${p.id}`}>{p.fullName}</Link></td>
                <td>{p.phone ?? p.email}</td>
                <td>{p.tags.map((t) => <span key={t} className="badge">{t}</span>)}</td>
                <td>{p.consentMissing && <span className="badge" title="Consentimento LGPD não registrado">⚠ consentimento</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">{r.total} paciente(s).</p>
    </main>
  );
}
