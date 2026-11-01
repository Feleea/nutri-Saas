'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../_lib/api';

type UsedSession = { id: string; appointmentId: string; usedAt: string };
type ConsultationPackage = {
  id: string;
  name: string;
  totalSessions: number;
  remainingSessions: number;
  amountCents: number;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  purchasedAt: string;
  sessions: UsedSession[];
};

const statusLabel: Record<ConsultationPackage['status'], string> = {
  ACTIVE: 'Ativo',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
};

const errorMessage = (code?: string) => {
  if (code === 'patient_not_found') return 'Paciente não encontrado ou inativo.';
  if (code === 'package_not_active') return 'Este pacote não está mais ativo.';
  if (code === 'forbidden') return 'Seu perfil não pode gerenciar pacotes.';
  if (code === 'validation') return 'Confira o nome, o número de sessões e o valor.';
  return 'Não foi possível concluir. Tente novamente.';
};

export default function PackagesPanel({ patientId, patientActive }: { patientId: string; patientActive: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<ConsultationPackage[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const result = await api(`/api/packages?patientId=${encodeURIComponent(patientId)}`, undefined, 'GET');
    if (result.status === 200) {
      setItems(result.data.items ?? []);
      setRemaining(result.data.balance?.remainingSessions ?? 0);
      setError('');
    } else {
      setError(errorMessage(result.data?.error?.code));
    }
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [patientId]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = String(form.get('amount') ?? '').trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setError('Informe um valor válido.');
      setSaving(false);
      return;
    }
    const result = await api('/api/packages', {
      patientId,
      name: String(form.get('name') ?? ''),
      totalSessions: Number(form.get('totalSessions')),
      amountCents: Math.round(Number(amount) * 100),
    });
    setSaving(false);
    if (result.status !== 201) {
      setError(errorMessage(result.data?.error?.code));
      return;
    }
    formElement.reset();
    setMessage('Pacote criado.');
    await refresh();
    router.refresh();
  }

  async function cancel(packageId: string) {
    setError('');
    setMessage('');
    const result = await api(`/api/packages/${packageId}/cancel`);
    if (result.status !== 200) {
      setError(errorMessage(result.data?.error?.code));
      return;
    }
    setMessage('Pacote cancelado. As sessões restantes não serão consumidas.');
    await refresh();
    router.refresh();
  }

  const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));

  return (
    <section className="card" aria-labelledby="packages-heading">
      <h2 id="packages-heading">Pacotes de consultas</h2>
      <p><strong>Saldo disponível:</strong> {remaining} {remaining === 1 ? 'sessão' : 'sessões'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok" role="status">{message}</p>}

      {patientActive && (
        <form onSubmit={create}>
          <h3>Novo pacote</h3>
          <label htmlFor="package-name">Nome do pacote</label>
          <input id="package-name" name="name" required maxLength={120} />
          <label htmlFor="package-sessions">Número de sessões</label>
          <input id="package-sessions" name="totalSessions" type="number" min="1" max="1000" step="1" required />
          <label htmlFor="package-amount">Valor total (R$)</label>
          <input id="package-amount" name="amount" type="number" min="0.01" step="0.01" required />
          <button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Criar pacote'}</button>
        </form>
      )}

      <h3>Pacotes registrados</h3>
      {loading ? <p role="status">Carregando pacotes…</p>
        : items.length === 0 ? <p>Nenhum pacote registrado para este paciente.</p>
          : <ul>
            {items.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> · <span className="badge">{statusLabel[item.status]}</span>
                <p>{item.remainingSessions} de {item.totalSessions} sessões restantes · {money(item.amountCents)} · adquirido em {date(item.purchasedAt)}</p>
                {item.sessions.length > 0 && (
                  <details>
                    <summary>Histórico de sessões utilizadas ({item.sessions.length})</summary>
                    <ul>{item.sessions.map((used) => <li key={used.id}>Consulta {used.appointmentId} · {date(used.usedAt)}</li>)}</ul>
                  </details>
                )}
                {item.status === 'ACTIVE' && (
                  <button type="button" className="secondary" onClick={() => void cancel(item.id)}>
                    Cancelar pacote
                  </button>
                )}
              </li>
            ))}
          </ul>}
      <p className="muted">Uma sessão é consumida ao marcar a consulta como realizada. Cancelamentos e faltas não consomem sessões; consultas concluídas não podem ser reabertas na agenda.</p>
    </section>
  );
}
