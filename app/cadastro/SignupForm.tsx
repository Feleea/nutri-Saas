'use client';
import { useState } from 'react';
import { api } from '../_lib/api';

export default function SignupForm() {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [errors, setErrors] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('busy');
    setErrors([]);
    const f = new FormData(e.currentTarget);
    const r = await api('/api/auth/signup', {
      accountName: String(f.get('accountName')), userName: String(f.get('userName')),
      email: String(f.get('email')), password: String(f.get('password')),
      acceptTerms: f.get('terms') === 'on', acceptPrivacy: f.get('terms') === 'on', acceptDpa: f.get('terms') === 'on',
    });
    if (r.status === 202) return setState('done');
    setState('idle');
    setErrors(r.data?.error?.errors ?? ['erro']);
  }

  if (state === 'done') {
    return <p className="ok">Enviamos um e-mail de confirmação. Se este endereço já tiver conta, o e-mail explica como entrar.</p>;
  }
  const msg: Record<string, string> = {
    email_invalid: 'E-mail inválido.', password_weak: 'A senha precisa de 10+ caracteres, com letras e números.',
    name_required: 'Informe seu nome e o nome do consultório.', terms_required: 'É necessário aceitar os termos.',
  };
  return (
    <form onSubmit={submit}>
      <label htmlFor="accountName">Nome do consultório ou clínica</label>
      <input id="accountName" name="accountName" required />
      <label htmlFor="userName">Seu nome</label>
      <input id="userName" name="userName" required />
      <label htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="password">Senha</label>
      <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      <label>
        <input type="checkbox" name="terms" required /> Li e aceito os termos de uso, a política de privacidade e o contrato de tratamento de dados.
      </label>
      <button disabled={state === 'busy'}>Criar conta</button>
      {errors.map((c) => <p key={c} className="error" role="alert">{msg[c] ?? 'Verifique os dados.'}</p>)}
    </form>
  );
}
