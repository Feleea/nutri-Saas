import SignupForm from './SignupForm';

export default function SignupPage() {
  return (
    <main className="narrow">
      <h1>Testar por 14 dias</h1>
      <p className="muted">Sem cartão de crédito.</p>
      <div className="card"><SignupForm /></div>
    </main>
  );
}
