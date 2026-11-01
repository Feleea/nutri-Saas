'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type PortalData = {
  appointments: {
    startsAt: string;
    endsAt: string;
    status: string;
    online: boolean;
    meetingUrl: string | null;
    professional: { name: string };
  }[];
  mealPlans: {
    id: string;
    title: string;
    versions: { version: number; createdAt: string; title: string; meals: { id: string; name: string; time: string; items: { foodName: string; quantity: number; measureLabel: string }[] }[] }[];
  }[];
};

export default function PortalHome() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/portal/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('unauthorized');
        setData(await response.json());
      })
      .catch(() => setFailed(true));
  }, []);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/portal/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } finally {
      router.replace('/portal/redeem');
    }
  }

  if (failed) return <main><h1>Portal do paciente</h1><p role="alert">Acesso inválido ou expirado. Solicite um novo convite à sua clínica.</p></main>;
  if (!data) return <main><h1>Portal do paciente</h1><p>Carregando…</p></main>;
  return (
    <main>
      <h1>Portal do paciente</h1>
      <p>Esta área contém somente suas próximas consultas e os planos alimentares aprovados para compartilhamento.</p>
      <section className="card">
        <h2>Próximas consultas</h2>
        {data.appointments.length === 0 ? <p>Nenhuma consulta agendada.</p> : data.appointments.map((appointment, index) => (
          <article key={`${appointment.startsAt}-${index}`}>
            <p><strong>{new Date(appointment.startsAt).toLocaleString('pt-BR')}</strong> até {new Date(appointment.endsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
            <p>Profissional: {appointment.professional.name}</p>
            <p>{appointment.status === 'CONFIRMED' ? 'Confirmada' : 'Agendada'}{appointment.online ? ' · Online' : ''}</p>
            {appointment.meetingUrl && <p><a href={appointment.meetingUrl} rel="noreferrer">Acessar consulta online</a></p>}
          </article>
        ))}
      </section>
      <section className="card">
        <h2>Planos alimentares aprovados</h2>
        {data.mealPlans.length === 0 ? <p>Nenhum plano aprovado para compartilhamento.</p> : data.mealPlans.map((plan) => (
          <article key={plan.id}>
            <h3>{plan.title}</h3>
            {plan.versions.map((version) => (
              <div key={version.version}>
                <h4>{version.title} · versão {version.version}</h4>
                {version.meals.map((meal) => (
                  <div key={meal.id}>
                    <h5>{meal.time} · {meal.name}</h5>
                    <ul>{meal.items.map((item, index) => <li key={`${meal.id}-${index}`}>{item.foodName} — {item.quantity} {item.measureLabel}</li>)}</ul>
                  </div>
                ))}
              </div>
            ))}
          </article>
        ))}
      </section>
      <button disabled={busy} onClick={() => void logout()}>Sair</button>
    </main>
  );
}
