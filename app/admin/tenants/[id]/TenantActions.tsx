'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../_lib/api';

export default function TenantActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');

  async function run(path: string, body?: unknown) {
    const r = await api(`/api/admin/tenants/${id}/${path}`, body);
    setMsg(r.status === 200 ? 'Ação registrada.' : 'Não foi possível aplicar a ação.');
    if (r.status === 200) router.refresh();
  }

  return (
    <div className="card">
      {status === 'SUSPENDED' ? (
        <button onClick={() => run('reactivate')}>Reativar conta</button>
      ) : (
        <button
          className="danger"
          onClick={() => {
            const reason = window.prompt('Motivo da suspensão (fica na auditoria):');
            if (reason?.trim()) run('suspend', { reason });
          }}
        >
          Suspender conta
        </button>
      )}{' '}
      {status === 'TRIAL' && (
        <button className="secondary" onClick={() => run('extend-trial', { days: 7 })}>Estender trial (+7 dias)</button>
      )}
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
