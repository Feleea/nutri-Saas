import InviteForm from './InviteForm';

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="narrow">
      <h1>Convite para a equipe</h1>
      <div className="card">{token ? <InviteForm token={token} /> : <p className="error">Link de convite inválido.</p>}</div>
    </main>
  );
}
