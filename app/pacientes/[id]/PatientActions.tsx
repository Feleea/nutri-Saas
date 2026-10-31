'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../_lib/api';

export default function PatientActions({ id, status, hasConsent }: { id: string; status: string; hasConsent: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState('');

  async function run(path: string, body?: unknown, after?: () => void) {
    const r = await api(`/api/patients/${id}/${path}`, body);
    if (r.status < 300) return after ? after() : router.refresh();
    setMsg(r.data?.error?.code === 'patient_limit' ? 'Limite do plano atingido: não é possível restaurar agora.'
      : r.data?.error?.code === 'retention_period' ? 'Este registro está em prazo de guarda obrigatória e não pode ser excluído.' : 'Não foi possível concluir.');
  }

  return (
    <div className="card">
      {!hasConsent && <button onClick={() => run('consent')}>Registrar consentimento</button>}{' '}
      {hasConsent && <button className="secondary" onClick={() => run('consent/revoke')}>Revogar consentimento</button>}{' '}
      {status === 'ACTIVE'
        ? <button className="secondary" onClick={() => run('archive')}>Arquivar</button>
        : <button className="secondary" onClick={() => run('restore')}>Restaurar</button>}{' '}
      <button className="secondary" onClick={async () => {
        const r = await api(`/api/patients/${id}/export`);
        if (r.status === 201) window.location.href = r.data.downloadUrl;
      }}>Exportar dados</button>{' '}
      <button className="danger" onClick={() => {
        if (window.confirm('Excluir definitivamente os dados deste paciente? Esta ação não pode ser desfeita.')) {
          run('delete', { mode: 'DELETE', confirm: true }, () => router.push('/pacientes'));
        }
      }}>Excluir</button>
      {msg && <p className="error" role="alert">{msg}</p>}
    </div>
  );
}
