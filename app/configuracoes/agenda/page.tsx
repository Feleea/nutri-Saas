import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import TenantManagementLinks from '@/app/_components/TenantManagementLinks';
import AppointmentPreferences from './AppointmentPreferences';

export const dynamic = 'force-dynamic';

export default async function AgendaSettingsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (session.role !== 'TITULAR') {
    return <main><h1>Preferências da agenda</h1><p className="error" role="alert">Somente o titular pode alterar as preferências da agenda.</p></main>;
  }
  const settings = await ctx().agenda.getSettings(session);
  return (
    <main>
      <TenantManagementLinks owner />
      <h1>Preferências da agenda</h1>
      <p className="muted">Estas definições valem para os horários e lembretes da conta.</p>
      <AppointmentPreferences initial={settings} />
    </main>
  );
}
