import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma, withTenant } from '@/src/db/tenant';
import { ctx } from '@/src/server/context';
import { can } from '@/src/server/permissions';
import { SESSION_COOKIE } from '@/src/server/web';
import LogoSettingsForm from './LogoSettingsForm';

export const dynamic = 'force-dynamic';

export default async function BrandSettings() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (!can(session.role, 'brand.read')) return <main><p>Acesso restrito à equipe clínica.</p></main>;
  const account = await withTenant(session.accountId, (tx) =>
    tx.account.findUnique({ where: { id: session.accountId }, select: { logoUrl: true } }), prisma);

  return (
    <main>
      <p><Link href="/agenda">← Voltar à agenda</Link></p>
      <h1>Identidade visual</h1>
      <p>Personalize a impressão dos planos alimentares da clínica.</p>
      <LogoSettingsForm initialUrl={account?.logoUrl ?? null} />
    </main>
  );
}
