'use client';

import { useEffect, useState } from 'react';
import { api } from '@/app/_lib/api';

type ApprovedPlan = { id: string; title: string };

export default function PortalInvite({
  patientId,
  plans,
  activeInvitation,
}: {
  patientId: string;
  plans: ApprovedPlan[];
  activeInvitation?: { id: string; expiresAt: string } | null;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [invitation, setInvitation] = useState(activeInvitation ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void api(`/api/portal/invitations?patientId=${encodeURIComponent(patientId)}`, undefined, 'GET')
      .then((result) => {
        if (result.status === 200) setInvitation(result.data.invitation ?? null);
      })
      .catch(() => {});
  }, [patientId]);

  async function send() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api('/api/portal/invitations', { patientId, approvedPlanIds: selected });
      if (result.status !== 201) {
        setError('Não foi possível enviar o acesso ao portal. Verifique o consentimento e tente novamente.');
      } else {
        setInvitation({ id: result.data.invitationId, expiresAt: result.data.expiresAt });
        setMessage('Convite enviado ao e-mail cadastrado do paciente. A seleção de planos define o que ficará visível.');
      }
    } catch {
      setError('Não foi possível enviar o acesso ao portal. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!invitation) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/portal/invitations/${encodeURIComponent(invitation.id)}/revoke`, {}, 'POST');
      if (result.status !== 200) setError('Não foi possível revogar o acesso. Tente novamente.');
      else {
        setInvitation(null);
        setMessage('Acesso revogado.');
      }
    } catch {
      setError('Não foi possível revogar o acesso. Verifique a conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="portal-invite-heading">
      <h2 id="portal-invite-heading">Portal do paciente</h2>
      <p className="muted">O convite será enviado somente ao e-mail cadastrado. Marque os planos que foram explicitamente aprovados para compartilhamento.</p>
      {plans.length === 0 ? <p className="muted">Nenhum plano disponível para aprovação.</p> : (
        <fieldset>
          <legend>Planos aprovados</legend>
          {plans.map((plan) => (
            <label key={plan.id} className="portal-plan-option">
              <input
                type="checkbox"
                checked={selected.includes(plan.id)}
                onChange={(event) => setSelected((value) =>
                  event.target.checked ? [...value, plan.id] : value.filter((id) => id !== plan.id),
                )}
              />
              {plan.title}
            </label>
          ))}
        </fieldset>
      )}
      <p>
        <button disabled={busy} onClick={() => void send()}>{invitation ? 'Reenviar convite e atualizar planos' : 'Enviar convite'}</button>
        {invitation && <> <button className="danger" disabled={busy} onClick={() => void revoke()}>Revogar convite/acesso</button></>}
      </p>
      {invitation && <p className="muted">Convite válido até {new Date(invitation.expiresAt).toLocaleString('pt-BR')}.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok" role="status">{message}</p>}
    </section>
  );
}
