import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import TemplateManager from './TemplateManager';

export const dynamic = 'force-dynamic';

export default async function AnamnesePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  const result = await ctx().clinical.listTemplates(session);
  if (!result.ok) return <main><p>Seu perfil não tem acesso aos modelos clínicos.</p></main>;
  return (
    <main>
      <p><a href="/painel">← Painel</a></p>
      <h1>Modelos de anamnese</h1>
      <p className="muted">As versões existentes são preservadas para manter o histórico dos preenchimentos.</p>
      <TemplateManager initialTemplates={result.items} />
    </main>
  );
}
