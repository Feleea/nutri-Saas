import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import TenantManagementLinks from '@/app/_components/TenantManagementLinks';
import TeamManager from './TeamManager';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (session.role !== 'TITULAR') {
    return <main><h1>Equipe</h1><p className="error" role="alert">Somente o titular pode gerenciar a equipe.</p><Link href="/agenda">Voltar à agenda</Link></main>;
  }
  const result = await ctx().team.list(session);
  if (!result.ok) {
    return <main><h1>Equipe</h1><p className="error" role="alert">Não foi possível carregar a equipe. Tente novamente.</p></main>;
  }
  return (
    <main>
      <TenantManagementLinks owner />
      <h1>Equipe</h1>
      <p className="muted">Convide profissionais e secretárias, acompanhe convites e remova acessos.</p>
      <TeamManager initialMembers={result.members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))} initialInvitations={result.invitations.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() }))} />
    </main>
  );
}
