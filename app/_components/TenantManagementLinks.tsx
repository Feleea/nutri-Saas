import Link from 'next/link';

export default function TenantManagementLinks({ owner }: { owner: boolean }) {
  return (
    <nav aria-label="Gerenciamento da conta">
      <p className="patient-clinical-links">
        <Link className="btn secondary" href="/agenda">Agenda</Link>
        {owner && <>
          <Link className="btn secondary" href="/equipe">Equipe</Link>
          <Link className="btn secondary" href="/assinatura">Plano e cobrança</Link>
          <Link className="btn secondary" href="/configuracoes/agenda">Preferências da agenda</Link>
          <Link className="btn secondary" href="/configuracoes/agenda-disponibilidade">Disponibilidade da agenda</Link>
        </>}
      </p>
    </nav>
  );
}
