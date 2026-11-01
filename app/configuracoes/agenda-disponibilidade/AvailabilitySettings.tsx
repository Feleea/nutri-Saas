'use client';

import { useState } from 'react';
import { api } from '@/app/_lib/api';

type Professional = { id: string; name: string };
type Rule = {
  id?: string;
  professionalUserId: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  active: boolean;
};
type Block = {
  id: string;
  professionalUserId: string | null;
  professionalName: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};
type Initial = { rules: Rule[]; professionals: Professional[]; blocks: Block[] };

const DAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const toTime = (minute: number) => {
  const value = minute === 1440 ? 1439 : minute;
  return `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};
const fromTime = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const localDateTime = (value: string, timezone: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function AvailabilitySettings({ initial, timezone }: { initial: Initial; timezone: string }) {
  const [rules, setRules] = useState(initial.rules);
  const [blocks, setBlocks] = useState(initial.blocks);
  const [professionals] = useState(initial.professionals);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function reportFailure(data: any) {
    const code = data?.error?.errors?.[0] ?? data?.error?.code;
    setError(code === 'professional_invalid' ? 'Selecione um profissional válido.'
      : code === 'block_conflict' ? 'O bloqueio coincide com uma consulta já agendada.'
        : code === 'forbidden' ? 'Somente o titular pode alterar estas configurações.'
          : code === 'csrf' ? 'Atualize a página e tente novamente.'
            : 'Verifique os horários e tente novamente.');
  }

  async function saveRules(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/agenda/availability', {
        rules: rules.map((rule) => ({ ...rule, professionalUserId: rule.professionalUserId || null })),
      });
      if (result.status !== 200) reportFailure(result.data);
      else { setRules(result.data.rules); setNotice('Disponibilidades salvas.'); }
    } catch { setError('Não foi possível salvar. Verifique a conexão e tente novamente.'); }
    finally { setBusy(false); }
  }

  async function addBlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await api('/api/agenda/blocks', {
        startDate: String(form.get('startDate')), startTime: String(form.get('startTime')),
        endDate: String(form.get('endDate')), endTime: String(form.get('endTime')),
        professionalUserId: String(form.get('professionalUserId') || '') || null,
        reason: String(form.get('reason') || '').trim() || null,
      });
      if (result.status !== 200) reportFailure(result.data);
      else {
        setBlocks(result.data.blocks);
        formElement.reset();
        setNotice('Bloqueio adicionado.');
      }
    } catch { setError('Não foi possível adicionar o bloqueio. Verifique a conexão e tente novamente.'); }
    finally { setBusy(false); }
  }

  async function removeBlock(id: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/api/agenda/blocks/${id}`, {}, 'DELETE');
      if (result.status !== 200) reportFailure(result.data);
      else { setBlocks(result.data.blocks); setNotice('Bloqueio removido.'); }
    } catch { setError('Não foi possível remover o bloqueio.'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <form className="card" onSubmit={saveRules}>
        <h2>Janelas semanais</h2>
        <p className="muted">Sem regras configuradas, os agendamentos continuam sem restrição de horário. Regras específicas substituem as regras gerais naquele dia; uma regra inativa fecha a janela.</p>
        {rules.map((rule, index) => (
          <fieldset key={rule.id ?? `new-${index}`} className="card">
            <legend>Janela {index + 1}</legend>
            <label htmlFor={`weekday-${index}`}>Dia da semana</label>
            <select id={`weekday-${index}`} value={rule.weekday} onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, weekday: Number(e.target.value) } : r))}>
              {DAYS.map((day, value) => <option key={day} value={value}>{day}</option>)}
            </select>
            <label htmlFor={`professional-${index}`}>Profissional</label>
            <select id={`professional-${index}`} value={rule.professionalUserId ?? ''} onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, professionalUserId: e.target.value || null } : r))}>
              <option value="">Toda a conta</option>
              {professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <label htmlFor={`start-${index}`}>Início</label>
            <input id={`start-${index}`} type="time" required value={toTime(rule.startMinute)} onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, startMinute: fromTime(e.target.value) } : r))} />
            <label htmlFor={`end-${index}`}>Fim</label>
            <input id={`end-${index}`} type="time" required value={toTime(rule.endMinute % 1440)} onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, endMinute: fromTime(e.target.value) } : r))} />
            <label><input type="checkbox" checked={rule.active} onChange={(e) => setRules(rules.map((r, i) => i === index ? { ...r, active: e.target.checked } : r))} /> Ativa</label>
            <button type="button" className="secondary" onClick={() => setRules(rules.filter((_, i) => i !== index))}>Remover janela</button>
          </fieldset>
        ))}
        <button type="button" className="secondary" onClick={() => setRules([...rules, { professionalUserId: null, weekday: 1, startMinute: 540, endMinute: 1020, active: true }])}>Adicionar janela</button>{' '}
        <button disabled={busy}>{busy ? 'Salvando…' : 'Salvar disponibilidades'}</button>
      </form>

      <section className="card">
        <h2>Bloqueios de agenda</h2>
        <form onSubmit={addBlock}>
          <label htmlFor="block-professional">Profissional</label>
          <select id="block-professional" name="professionalUserId" defaultValue="">
            <option value="">Toda a conta</option>
            {professionals.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <label htmlFor="block-start-date">Início</label>
          <div className="filters">
            <input id="block-start-date" name="startDate" type="date" required />
            <input name="startTime" type="time" required aria-label="Horário inicial" />
          </div>
          <label htmlFor="block-end-date">Fim</label>
          <div className="filters">
            <input id="block-end-date" name="endDate" type="date" required />
            <input name="endTime" type="time" required aria-label="Horário final" />
          </div>
          <label htmlFor="block-reason">Motivo (opcional)</label>
          <input id="block-reason" name="reason" maxLength={200} />
          <button disabled={busy}>{busy ? 'Salvando…' : 'Adicionar bloqueio'}</button>
        </form>
        {blocks.length ? (
          <ul>
            {blocks.map((block) => (
              <li key={block.id}>
                {localDateTime(block.startsAt, timezone)} – {localDateTime(block.endsAt, timezone)}
                {' · '}{block.professionalName ?? 'Toda a conta'}{block.reason ? ` · ${block.reason}` : ''}
                {' '}<button type="button" className="secondary" disabled={busy} onClick={() => void removeBlock(block.id)}>Remover</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nenhum bloqueio futuro.</p>}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
    </div>
  );
}
