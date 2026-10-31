'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../_lib/api';

const MSG: Record<string, string> = {
  name_required: 'Informe o nome.', contact_required: 'Informe um telefone ou e-mail.', email_invalid: 'E-mail inválido.',
  phone_invalid: 'Telefone inválido.', cpf_invalid: 'CPF inválido.',
};

export default function PatientForm() {
  const router = useRouter();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [limit, setLimit] = useState<{ limit: number; count: number } | null>(null);
  const [restricted, setRestricted] = useState(false);

  async function send(body: Record<string, unknown>) {
    const r = await api('/api/patients', body);
    setErrors([]); setDuplicate(false); setLimit(null); setRestricted(false);
    if (r.status === 201) return router.push(`/pacientes/${r.data.patient.id}`);
    const code = r.data?.error?.code;
    if (code === 'duplicate_cpf') return setDuplicate(true);
    if (code === 'patient_limit') return setLimit({ limit: r.data.error.limit, count: r.data.error.count });
    if (code === 'access_restricted') return setRestricted(true);
    setErrors(r.data?.error?.errors ?? ['erro']);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      fullName: String(f.get('fullName')),
      phone: String(f.get('phone') || '') || null,
      email: String(f.get('email') || '') || null,
      cpf: String(f.get('cpf') || '') || null,
      goal: String(f.get('goal') || '') || null,
      tags: String(f.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      consent: f.get('consent') === 'on',
    };
    setPayload(body);
    void send(body);
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">Cadastro enxuto: o restante pode ser preenchido depois.</p>
      <label htmlFor="fullName">Nome</label><input id="fullName" name="fullName" required />
      <label htmlFor="phone">Telefone</label><input id="phone" name="phone" inputMode="tel" />
      <label htmlFor="email">E-mail</label><input id="email" name="email" type="email" />
      <label htmlFor="goal">Objetivo</label><input id="goal" name="goal" />
      <label htmlFor="cpf">CPF (opcional)</label><input id="cpf" name="cpf" inputMode="numeric" />
      <label htmlFor="tags">Etiquetas (separadas por vírgula)</label><input id="tags" name="tags" />
      <label><input type="checkbox" name="consent" /> O paciente consentiu com o tratamento dos dados (LGPD).</label>
      <button>Salvar</button>
      {duplicate && payload && (
        <p className="error" role="alert">
          Já existe um paciente com este CPF.{' '}
          <button type="button" className="secondary" onClick={() => send({ ...payload, confirmDuplicate: true })}>Cadastrar mesmo assim</button>
        </p>
      )}
      {limit && <p className="error" role="alert">Você atingiu o limite do plano ({limit.count} de {limit.limit} pacientes). Seus pacientes continuam acessíveis. <a href="/painel">Fazer upgrade</a></p>}
      {restricted && <p className="error" role="alert">Novos cadastros estão bloqueados pela situação da assinatura. Seus dados continuam acessíveis. <a href="/painel">Regularizar</a></p>}
      {errors.map((c) => <p key={c} className="error" role="alert">{MSG[c] ?? 'Verifique os dados.'}</p>)}
    </form>
  );
}
