'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../_lib/api';

export default function AppointmentForm() {
  const router = useRouter();
  const [matches, setMatches] = useState<{ id: string; name: string }[]>([]);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);

  async function search(q: string) {
    setPatient(null);
    if (!q.trim()) return setMatches([]);
    const r = await api(`/api/agenda/patients?q=${encodeURIComponent(q)}`, undefined, 'GET');
    setMatches(r.data?.patients ?? []);
  }

  async function send(body: Record<string, unknown>) {
    const r = await api('/api/agenda', body);
    setError(''); setConflict(null);
    if (r.status === 201) return router.push(`/agenda?day=${r.data.appointment.local.date}`);
    const code = r.data?.error?.code;
    if (code === 'conflict') return setConflict(body);
    setError(code === 'in_the_past' ? 'Escolha um horário futuro.' : code === 'access_restricted' ? 'A agenda está somente leitura pela situação da assinatura.'
      : code === 'professional_required' ? 'Informe o profissional.' : 'Verifique os dados.');
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!patient) return setError('Selecione o paciente.');
    const f = new FormData(e.currentTarget);
    void send({
      patientId: patient.id, date: String(f.get('date')), time: String(f.get('time')),
      durationMinutes: f.get('duration') ? Number(f.get('duration')) : undefined,
      online: f.get('online') === 'on', meetingUrl: String(f.get('url') || '') || null,
    });
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="q">Paciente</label>
      <input id="q" autoComplete="off" onChange={(e) => void search(e.target.value)} placeholder="Digite parte do nome" />
      {patient ? <p className="ok">Selecionado: {patient.name}</p> : matches.map((m) => (
        <button type="button" key={m.id} className="secondary" onClick={() => { setPatient(m); setMatches([]); }}>{m.name}</button>
      ))}
      <label htmlFor="date">Data</label><input id="date" name="date" type="date" required />
      <label htmlFor="time">Horário</label><input id="time" name="time" type="time" required />
      <label htmlFor="duration">Duração (minutos; vazio = padrão da conta)</label><input id="duration" name="duration" type="number" min={5} max={480} />
      <label><input type="checkbox" name="online" /> Consulta online</label>
      <label htmlFor="url">Link da videochamada (https)</label><input id="url" name="url" type="url" />
      <button>Agendar</button>
      {conflict && (
        <p className="error" role="alert">Já existe outra consulta neste horário.{' '}
          <button type="button" className="secondary" onClick={() => send({ ...conflict, confirmConflict: true })}>Agendar mesmo assim</button></p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
