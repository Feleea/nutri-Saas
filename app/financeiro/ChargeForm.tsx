'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../_lib/api';

type Patient = { id: string; name: string };
type Appointment = { id: string; startsAt: string; status: string };

export default function ChargeForm({ today, timezone }: { today: string; timezone: string }) {
  const router = useRouter();
  const [matches, setMatches] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [paid, setPaid] = useState(false);

  async function searchPatients(value: string) {
    setPatient(null);
    setAppointments([]);
    if (!value.trim()) return setMatches([]);
    const result = await api(`/api/finance/patients?q=${encodeURIComponent(value.trim())}`, undefined, 'GET');
    setMatches(result.data?.patients ?? []);
  }

  async function selectPatient(selected: Patient) {
    setPatient(selected);
    setMatches([]);
    const result = await api(`/api/finance/patients?patientId=${encodeURIComponent(selected.id)}`, undefined, 'GET');
    setAppointments(result.data?.appointments ?? []);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!patient) return setError('Selecione um paciente.');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = String(form.get('amount') ?? '').trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Informe um valor válido.');
    const result = await api('/api/finance/charges', {
      patientId: patient.id,
      appointmentId: String(form.get('appointmentId') || '') || null,
      description: String(form.get('description')),
      amountCents: Math.round(Number(amount) * 100),
      paymentMethod: String(form.get('paymentMethod')),
      status: paid ? 'PAID' : 'PENDING',
      occurredAt: String(form.get('occurredAt')),
      paidAt: paid ? String(form.get('paidAt') || '') || null : null,
    });
    if (result.status !== 201) {
      setError(result.data?.error?.code === 'appointment_not_found'
        ? 'A consulta selecionada não corresponde ao paciente.'
        : 'Não foi possível registrar a cobrança. Verifique os dados.');
      return;
    }
    formElement.reset();
    setPatient(null);
    setAppointments([]);
    setPaid(false);
    setMessage('Cobrança registrada.');
    router.refresh();
  }

  return (
    <section className="card">
      <h2>Nova cobrança</h2>
      <form onSubmit={submit}>
        <label htmlFor="finance-patient">Paciente</label>
        <input id="finance-patient" autoComplete="off" onChange={(event) => void searchPatients(event.target.value)} placeholder="Buscar paciente pelo nome" />
        {patient && <p className="ok">Paciente: {patient.name}</p>}
        {matches.map((item) => <button type="button" className="secondary" key={item.id} onClick={() => void selectPatient(item)}>{item.name}</button>)}
        <label htmlFor="appointmentId">Consulta relacionada (opcional)</label>
        <select id="appointmentId" name="appointmentId" disabled={!patient} defaultValue="">
          <option value="">Sem consulta específica</option>
          {appointments.map((item) => <option key={item.id} value={item.id}>
            {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(item.startsAt))} · {item.status}
          </option>)}
        </select>
        <label htmlFor="description">Descrição</label><input id="description" name="description" required maxLength={160} placeholder="Ex.: Consulta nutricional" />
        <label htmlFor="amount">Valor (R$)</label><input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
        <label htmlFor="paymentMethod">Forma de pagamento</label>
        <select id="paymentMethod" name="paymentMethod" defaultValue="PIX">
          <option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="CREDIT_CARD">Cartão de crédito</option>
          <option value="DEBIT_CARD">Cartão de débito</option><option value="TRANSFER">Transferência</option><option value="OTHER">Outro</option>
        </select>
        <label htmlFor="occurredAt">Data da cobrança</label><input id="occurredAt" name="occurredAt" type="date" defaultValue={today} required />
        <label><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Já foi recebida</label>
        {paid && <><label htmlFor="paidAt">Data do recebimento</label><input id="paidAt" name="paidAt" type="date" defaultValue={today} /></>}
        <button type="submit">Registrar cobrança</button>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="ok" role="status">{message}</p>}
      </form>
    </section>
  );
}
