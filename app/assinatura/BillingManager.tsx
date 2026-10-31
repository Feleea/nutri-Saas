'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_lib/api';

type Plan = { code: string; name: string; priceCents: number; modules: string[]; patientLimit: number | null; userLimit: number | null; storageMb: number | null };
type Subscription = {
  status: string;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  priceCents: number;
  plan: { code: string; name: string; patientLimit: number | null; userLimit: number | null };
  pendingPlan: { code: string; name: string } | null;
};

const STATUS: Record<string, string> = { TRIAL: 'Período de teste', ACTIVE: 'Ativa', PAST_DUE: 'Pagamento pendente', SUSPENDED: 'Suspensa', CANCELED: 'Cancelada' };
const ACCESS: Record<string, string> = { FULL: 'Acesso completo', NO_NEW_PATIENTS: 'Novos cadastros bloqueados; dados existentes continuam acessíveis.', READ_ONLY: 'Acesso somente para leitura.' };
const ERRORS: Record<string, string> = {
  plan_unavailable: 'Este plano não está disponível.',
  no_subscription: 'Não há assinatura vinculada à conta.',
  not_subscribed: 'A alteração direta está disponível apenas para assinaturas ativas.',
  same_plan: 'Este já é o plano atual.',
  csrf: 'A solicitação não passou pela validação de segurança. Atualize a página e tente novamente.',
  forbidden: 'Você não tem permissão para alterar o plano.',
};
const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const limit = (value: number | null, unit: string) => value === null ? 'Sem limite' : `${value} ${unit}`;
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value));

export default function BillingManager({ access, subscription, plans }: { access: { mode: string; patientsTotal: number; patientLimit: number | null }; subscription: Subscription | null; plans: Plan[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [method, setMethod] = useState<'CARD' | 'PIX' | 'BOLETO'>('PIX');

  async function selectPlan(planCode: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const active = subscription?.status === 'ACTIVE';
      const result = await api(active ? '/api/billing/change-plan' : '/api/billing/checkout', active ? { planCode } : { planCode, method });
      if (result.status !== 200) setError(ERRORS[result.data?.error?.code] ?? 'Não foi possível solicitar a alteração. Tente novamente.');
      else if (active) {
        const detail = result.data.prorationCents > 0 ? ` Ajuste proporcional: ${brl(result.data.prorationCents)}.` : '';
        setNotice(`Plano alterado para ${planCode}.${detail}`);
        router.refresh();
      } else {
        setNotice(`Solicitação de contratação criada. Valor: ${brl(result.data.amountCents)}. A ativação depende da confirmação do pagamento.`);
        router.refresh();
      }
    } catch {
      setError('Não foi possível solicitar a alteração. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Assinatura atual</h2>
        {subscription ? <>
          <p><strong>Plano:</strong> {subscription.plan.name} <span className="badge">{subscription.plan.code}</span></p>
          <p><strong>Situação:</strong> {STATUS[subscription.status] ?? subscription.status}</p>
          <p><strong>Valor contratado:</strong> {brl(subscription.priceCents)}</p>
          <p><strong>Pacientes:</strong> {access.patientsTotal}{access.patientLimit === null ? '' : ` de ${access.patientLimit}`}</p>
          <p><strong>Acesso:</strong> {ACCESS[access.mode] ?? access.mode}</p>
          {subscription.currentPeriodEnd && <p><strong>Período até:</strong> {date(subscription.currentPeriodEnd)}</p>}
          {subscription.graceEndsAt && <p><strong>Fim da carência:</strong> {date(subscription.graceEndsAt)}</p>}
          {subscription.pendingPlan && <p><strong>Alteração pendente:</strong> {subscription.pendingPlan.name}</p>}
        </> : <p className="muted">Nenhuma assinatura encontrada.</p>}
      </section>
      <section className="card">
        <h2>Planos disponíveis</h2>
        {plans.length === 0 ? <p className="muted">Não há planos disponíveis no momento.</p> : plans.map((plan) => (
          <article className="card" key={plan.code}>
            <h3>{plan.name} {subscription?.plan.code === plan.code && <span className="badge">Plano atual</span>}</h3>
            <p><strong>{brl(plan.priceCents)}</strong> / período</p>
            <p>Pacientes: {limit(plan.patientLimit, 'pacientes')} · Usuários: {limit(plan.userLimit, 'usuários')}</p>
            <p>Armazenamento: {limit(plan.storageMb, 'MB')}</p>
            <p className="muted">Módulos: {plan.modules.join(', ') || '—'}</p>
            {subscription?.plan.code !== plan.code && <button disabled={busy} onClick={() => void selectPlan(plan.code)}>{subscription?.status === 'ACTIVE' ? 'Mudar para este plano' : 'Solicitar este plano'}</button>}
          </article>
        ))}
        {subscription?.status !== 'ACTIVE' && plans.some((p) => p.code !== subscription?.plan.code) && <>
          <label htmlFor="payment-method">Forma de pagamento</label>
          <select id="payment-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="BOLETO">Boleto</option>
          </select>
        </>}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
    </>
  );
}
