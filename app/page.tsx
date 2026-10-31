import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && (await ctx().auth.validateSession(token))) redirect('/painel');
  return (
    <main className="narrow">
      <h1>Suas Nutri</h1>
      <p className="muted">Gestão clínica e de produção para nutricionistas. Nem nós conseguimos ver os dados dos seus pacientes.</p>
      <Link className="btn" href="/login">Entrar</Link>{' '}
      <Link className="btn secondary" href="/cadastro">Testar por 14 dias</Link>
    </main>
  );
}
