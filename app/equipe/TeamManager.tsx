'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_lib/api';

type Member = { id: string; name: string; email: string; role: string; createdAt: string };
type Invitation = { id: string; email: string; role: string; createdAt: string; expiresAt: string };

const ROLE: Record<string, string> = { TITULAR: 'Titular', PROFISSIONAL: 'Profissional', SECRETARIA: 'Secretária' };
const ERROR: Record<string, string> = {
  already_member: 'Este e-mail já faz parte da equipe.',
  invalid_email: 'Informe um e-mail válido.',
  user_limit: 'O limite de pessoas do plano foi atingido.',
  forbidden: 'Você não tem permissão para esta ação.',
  csrf: 'A solicitação não passou pela validação de segurança. Atualize a página e tente novamente.',
};

export default function TeamManager({ initialMembers, initialInvitations }: { initialMembers: Member[]; initialInvitations: Invitation[] }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const result = await api('/api/team', undefined, 'GET');
      if (result.status !== 200) {
        setError(ERROR[result.data?.error?.code] ?? 'Não foi possível atualizar a equipe. Tente novamente.');
        return false;
      }
      setMembers(result.data.members);
      setInvitations(result.data.invitations);
      router.refresh();
      return true;
    } catch {
      setError('Não foi possível atualizar a equipe. Verifique a conexão e tente novamente.');
      return false;
    }
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('/api/team/invite', { email: String(form.get('email')), role: String(form.get('role')) });
      if (result.status !== 201) setError(ERROR[result.data?.error?.code] ?? 'Não foi possível enviar o convite. Tente novamente.');
      else {
        formElement.reset();
        setNotice('Convite enviado por e-mail.');
        await reload();
      }
    } catch {
      setError('Não foi possível enviar o convite. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function mutate(url: string, method: 'DELETE' | 'POST', success: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(url, {}, method);
      if (result.status !== 200) setError(ERROR[result.data?.error?.code] ?? 'Não foi possível concluir a ação. Tente novamente.');
      else {
        setNotice(success);
        await reload();
      }
    } catch {
      setError('Não foi possível concluir a ação. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Convidar pessoa</h2>
        <form onSubmit={invite}>
          <label htmlFor="team-email">E-mail</label><input id="team-email" name="email" type="email" maxLength={254} required />
          <label htmlFor="team-role">Papel</label>
          <select id="team-role" name="role" defaultValue="PROFISSIONAL">
            <option value="PROFISSIONAL">Profissional</option><option value="SECRETARIA">Secretária</option>
          </select>
          <button disabled={busy}>Enviar convite</button>
        </form>
      </section>
      <section className="card">
        <h2>Membros ({members.length})</h2>
        {members.length === 0 ? <p className="muted">Nenhum membro cadastrado.</p> : (
          <table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Acesso</th></tr></thead>
            <tbody>{members.map((m) => <tr key={m.id}>
              <td>{m.name}</td><td>{m.email}</td><td>{ROLE[m.role] ?? m.role}</td>
              <td>{m.role === 'TITULAR' ? <span className="badge">Titular da conta</span> : <button className="danger" disabled={busy} onClick={() => {
                if (window.confirm(`Remover o acesso de ${m.name}?`)) void mutate(`/api/team/members/${encodeURIComponent(m.id)}`, 'DELETE', 'Acesso removido.');
              }}>Remover</button>}</td>
            </tr>)}</tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>Convites pendentes ({invitations.length})</h2>
        {invitations.length === 0 ? <p className="muted">Nenhum convite pendente.</p> : (
          <table><thead><tr><th>E-mail</th><th>Papel</th><th>Expira em</th><th></th></tr></thead>
            <tbody>{invitations.map((i) => <tr key={i.id}>
              <td>{i.email}</td><td>{ROLE[i.role] ?? i.role}</td><td>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(i.expiresAt))}</td>
              <td><button className="danger" disabled={busy} onClick={() => void mutate(`/api/team/invitations/${encodeURIComponent(i.id)}/revoke`, 'POST', 'Convite revogado.')}>Revogar</button></td>
            </tr>)}</tbody>
          </table>
        )}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
    </>
  );
}
