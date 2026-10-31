'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorText } from '../_lib/api';

export default function LoginForm() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const r = challenge
      ? await api('/api/auth/mfa', { challenge, code: String(f.get('code')) })
      : await api('/api/auth/login', { email: String(f.get('email')), password: String(f.get('password')) });
    setBusy(false);
    if (r.status === 200 && r.data?.mfa_required) return setChallenge(r.data.challenge);
    if (r.status === 200) return router.push('/painel');
    setError(errorText(r.status, r.data));
  }

  return (
    <form onSubmit={submit}>
      {challenge ? (
        <>
          <label htmlFor="code">Código do aplicativo autenticador (ou código de recuperação)</label>
          <input id="code" name="code" autoComplete="one-time-code" required autoFocus />
        </>
      ) : (
        <>
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </>
      )}
      <button disabled={busy}>{challenge ? 'Confirmar' : 'Entrar'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
