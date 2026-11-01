'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function PortalRedeem() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState('Validando o convite…');

  useEffect(() => {
    const token = params.get('token') ?? '';
    if (!token) {
      setMessage('Este convite é inválido ou expirou. Solicite um novo acesso à sua clínica.');
      return;
    }
    window.history.replaceState(null, '', '/portal/redeem');
    void fetch('/api/portal/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }).then(async (response) => {
      if (!response.ok) throw new Error('invalid');
      router.replace('/portal');
    }).catch(() => {
      setMessage('Este convite é inválido ou expirou. Solicite um novo acesso à sua clínica.');
    });
  }, [params, router]);

  return <main><h1>Acesso ao portal</h1><p role="status">{message}</p></main>;
}
