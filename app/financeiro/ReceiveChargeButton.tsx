'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../_lib/api';

export default function ReceiveChargeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function receive() {
    setBusy(true);
    setError(false);
    const result = await api(`/api/finance/charges/${encodeURIComponent(id)}/receive`, {});
    setBusy(false);
    if (result.status === 200) router.refresh();
    else setError(true);
  }

  return <>
    <button type="button" className="link-button" disabled={busy} onClick={() => void receive()}>
      {busy ? 'Salvando…' : 'Marcar como recebido'}
    </button>
    {error && <span className="error" role="alert">Falha ao atualizar.</span>}
  </>;
}
