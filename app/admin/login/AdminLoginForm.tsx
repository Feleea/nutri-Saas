'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorText } from '../../_lib/api';

export default function AdminLoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await api('/api/admin/login', { email: String(f.get('email')), password: String(f.get('password')), code: String(f.get('code')) });
    if (r.status === 200) return router.push('/admin');
    setError(errorText(r.status, r.data));
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" required />
      <label htmlFor="password">Senha</label>
      <input id="password" name="password" type="password" required />
      <label htmlFor="code">Código do autenticador (obrigatório)</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      <button>Entrar</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
