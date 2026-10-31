import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import TenantManagementLinks from '@/app/_components/TenantManagementLinks';
import BillingManager from './BillingManager';

export const dynamic = 'force-dynamic';

export default async function SubscriptionPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (session.role !== 'TITULAR') {
    return <main><h1>Plano e cobrança</h1><p className="error" role="alert">Somente o titular pode acessar a assinatura.</p></main>;
  }
  const [access, subscription, plans] = await Promise.all([
    ctx().billing.loadAccessState(session.accountId),
    ctx().billing.loadSubscription(session.accountId),
    ctx().billing.listOfferedPlans(),
  ]);
  return (
    <main>
      <TenantManagementLinks owner />
      <h1>Plano e cobrança</h1>
      <BillingManager
        access={{ mode: access.mode, patientsTotal: access.patientsTotal, patientLimit: access.patientLimit }}
        subscription={subscription ? { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null, graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null } : null}
        plans={plans.map((p) => ({ code: p.code, name: p.name, priceCents: p.priceCents, modules: p.modules, patientLimit: p.patientLimit, userLimit: p.userLimit, storageMb: p.storageMb }))}
      />
    </main>
  );
}
