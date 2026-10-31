import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import RecipeManager from './RecipeManager';

export const dynamic = 'force-dynamic';

export default async function AlimentosPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (!['TITULAR', 'PROFISSIONAL'].includes(session.role)) return <main><p>Acesso restrito à equipe clínica.</p></main>;
  return <main>
    <p><Link href="/painel">← Painel</Link></p>
    <h1>Receitas e alimentos</h1>
    <RecipeManager />
  </main>;
}
