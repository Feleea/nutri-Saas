'use client';
import { useState } from 'react';
import { api } from '../_lib/api';

export default function InviteForm({ token }: { token: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const terms = f.get('terms') === 'on';
    const r = await api('/api/team/accept', {
      token, userName: String(f.get('userName') ?? ''), password: String(f.get('password') ?? ''),
      acceptTerms: terms, acceptPrivacy: terms, acceptDpa: terms,
    });
    if (r.status === 200) return setMsg({ ok: true, text: 'Convite aceito. Agora você já pode entrar.' });
    setMsg({ ok: false, text: r.status === 409 ? 'O limite de usuários do plano foi atingido.' : 'Convite inválido, expirado ou dados incorretos.' });
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">Se você já tem conta, informe apenas a senha dela. Se é novo, informe também seu nome.</p>
      <label htmlFor="userName">Seu nome (apenas se for novo)</label>
      <input id="userName" name="userName" />
      <label htmlFor="password">Senha</label>
      <input id="password" name="password" type="password" required />
      <label><input type="checkbox" name="terms" /> Aceito os termos, a política de privacidade e o contrato de tratamento de dados (obrigatório para quem é novo).</label>
      <button>Aceitar convite</button>
      {msg && <p className={msg.ok ? 'ok' : 'error'} role="alert">{msg.text}</p>}
    </form>
  );
}
