'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../_lib/api';

export default function AgendaActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');

  async function call(path: string, body: unknown) {
    const r = await api(`/api/agenda/${id}/${path}`, body);
    if (r.status === 200) return router.refresh();
    if (r.status === 409 && r.data?.error?.code === 'conflict') {
      if (window.confirm('Já existe outra consulta neste horário. Reagendar mesmo assim?')) return call(path, { ...(body as object), confirmConflict: true });
      return;
    }
    setMsg('Não foi possível concluir.');
  }

  return (
    <span>
      {status === 'SCHEDULED' && <button className="secondary" onClick={() => call('status', { status: 'CONFIRMED' })}>Confirmar</button>}{' '}
      <button className="secondary" onClick={() => {
        const date = window.prompt('Nova data (AAAA-MM-DD):');
        const time = date && window.prompt('Novo horário (HH:MM):');
        if (date && time) void call('reschedule', { date, time });
      }}>Reagendar</button>{' '}
      <button className="danger" onClick={() => {
        const reason = window.prompt('Motivo do cancelamento:');
        if (reason?.trim()) void call('cancel', { reason });
      }}>Cancelar</button>
      {msg && <span className="error" role="alert"> {msg}</span>}
    </span>
  );
}
