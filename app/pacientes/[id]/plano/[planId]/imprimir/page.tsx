import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma, withTenant } from '@/src/db/tenant';
import { ctx } from '@/src/server/context';
import { SESSION_COOKIE } from '@/src/server/web';
import type { NutrientTotals } from '@/src/meal-plans/nutrition';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

const labels: Record<string, string> = {
  energyKcal: 'Energia (kcal)', proteinG: 'Proteínas (g)', carbG: 'Carboidratos (g)',
  fatG: 'Gorduras (g)', fiberG: 'Fibras (g)',
};

function Totals({ totals }: { totals: NutrientTotals }) {
  return <dl className="nutrition-totals">{Object.entries(totals).map(([key, total]) => (
    <div key={key}><dt>{labels[key] ?? key}</dt><dd>{total.complete ? total.value : 'Não informado'}</dd></div>
  ))}</dl>;
}

export default async function PrintableMealPlan({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; planId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id, planId } = await params;
  const { version: requestedVersion } = await searchParams;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await ctx().auth.validateSession(token) : null;
  if (!session) redirect('/login');
  if (!['TITULAR', 'PROFISSIONAL'].includes(session.role)) return <main><p>Acesso restrito à equipe clínica.</p></main>;

  const [patientResult, planResult, account] = await Promise.all([
    ctx().patients.get(session, id),
    ctx().mealPlans.get(session, id, planId),
    withTenant(session.accountId, (tx) => tx.account.findUnique({
      where: { id: session.accountId },
    select: { name: true, crn: true, phone: true, email: true, logoUrl: true },
    }), prisma),
  ]);
  if (!patientResult.ok || !planResult.ok) return <main><p>Plano alimentar não encontrado ou sem acesso.</p></main>;
  if (patientResult.alerts.includes('consent_missing')) return <main><p>Consentimento de tratamento de dados ausente.</p></main>;

  const numericVersion = requestedVersion ? Number(requestedVersion) : NaN;
  const selectedVersion = Number.isInteger(numericVersion)
    ? planResult.plan.versions.find((item) => item.version === numericVersion)
    : planResult.plan.versions[0];
  if (!selectedVersion) return <main><p>Versão do plano não encontrada.</p><Link href={`/pacientes/${id}/plano`}>Voltar ao plano</Link></main>;

  return (
    <main className="printable-meal-plan">
      <div className="print-hidden print-controls">
        <Link className="btn secondary" href={`/pacientes/${id}/plano`}>Voltar ao plano</Link>
        <PrintButton />
      </div>
      <header className="print-header">
        {account?.logoUrl && <img className="print-logo" src={account.logoUrl} alt={`Logotipo de ${account.name}`} referrerPolicy="no-referrer" />}
        <h1>{account?.name ?? 'Plano alimentar'}</h1>
        {(account?.crn || account?.phone || account?.email) && (
          <p>{[account.crn && `CRN ${account.crn}`, account.phone, account.email].filter(Boolean).join(' · ')}</p>
        )}
      </header>
      <h2>{selectedVersion.title}</h2>
      <p>Paciente: {patientResult.patient.fullName}</p>
      <p>Versão {selectedVersion.version} · Emitido em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date())}</p>
      {selectedVersion.meals.map((meal) => (
        <section className="print-meal" key={meal.id}>
          <h3>{meal.time} · {meal.name}</h3>
          <ul>{meal.items.map((item) => (
            <li key={item.id}>
              {item.foodName}: {item.quantity} {item.measureLabel} ({item.grams} g)
              {item.alternatives.length > 0 && (
                <ul><li>Substituições:
                  <ul>{item.alternatives.map((alternative) => (
                    <li key={alternative.id}>{alternative.foodName}: {alternative.grams} g</li>
                  ))}</ul>
                </li></ul>
              )}
            </li>
          ))}</ul>
          <Totals totals={meal.totals} />
        </section>
      ))}
      <h3>Total do dia</h3>
      <Totals totals={selectedVersion.totals} />
      <footer className="print-footer">Documento gerado pelo Suas Nutri.</footer>
    </main>
  );
}
