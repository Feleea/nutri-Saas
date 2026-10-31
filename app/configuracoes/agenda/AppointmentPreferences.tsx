'use client';

import { useState } from 'react';
import { api } from '@/app/_lib/api';

type Settings = { timezone: string; defaultAppointmentMinutes: number; reminderLeadHours: number };
const ERROR: Record<string, string> = {
  timezone_invalid: 'Informe um fuso horário válido, como America/Sao_Paulo.',
  duration_invalid: 'A duração deve estar entre 5 e 480 minutos.',
  lead_invalid: 'O prazo do lembrete deve estar entre 1 e 168 horas.',
  forbidden: 'Você não tem permissão para alterar estas preferências.',
  csrf: 'A solicitação não passou pela validação de segurança. Atualize a página e tente novamente.',
};

export default function AppointmentPreferences({ initial }: { initial: Settings }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/settings/agenda', values);
      if (result.status !== 200) {
        const code = result.data?.error?.errors?.[0] ?? result.data?.error?.code;
        setError(ERROR[code] ?? 'Não foi possível salvar as preferências. Verifique os dados e tente novamente.');
      } else {
        setValues(result.data);
        setNotice('Preferências salvas.');
      }
    } catch {
      setError('Não foi possível salvar as preferências. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor="timezone">Fuso horário IANA</label>
      <input id="timezone" value={values.timezone} maxLength={60} required onChange={(e) => setValues({ ...values, timezone: e.target.value })} />
      <p className="muted">Exemplo: America/Sao_Paulo.</p>
      <label htmlFor="duration">Duração padrão da consulta (minutos)</label>
      <input id="duration" type="number" min={5} max={480} step={1} required value={values.defaultAppointmentMinutes} onChange={(e) => setValues({ ...values, defaultAppointmentMinutes: Number(e.target.value) })} />
      <label htmlFor="lead">Antecedência dos lembretes (horas)</label>
      <input id="lead" type="number" min={1} max={168} step={1} required value={values.reminderLeadHours} onChange={(e) => setValues({ ...values, reminderLeadHours: Number(e.target.value) })} />
      <button disabled={busy}>{busy ? 'Salvando…' : 'Salvar preferências'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
    </form>
  );
}
