import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import AvailabilitySettings from './AvailabilitySettings';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (session.role !== 'TITULAR') {
    return <main><h1>Disponibilidade da agenda</h1><p className="error" role="alert">Somente o titular pode configurar disponibilidades e bloqueios.</p></main>;
  }
  const [settings, preferences] = await Promise.all([
    ctx().agenda.getAvailabilitySettings(session),
    ctx().agenda.getSettings(session),
  ]);
  if (!settings.ok) return <main><h1>Disponibilidade da agenda</h1><p className="error">Não foi possível carregar as configurações.</p></main>;
  return (
    <main>
      <h1>Disponibilidade e bloqueios</h1>
      <p className="muted">Os horários são interpretados no fuso {preferences.timezone}. As janelas não podem atravessar a meia-noite.</p>
      <AvailabilitySettings initial={settings} timezone={preferences.timezone} />
    </main>
  );
}
