import PatientForm from './PatientForm';

export default function NovoPaciente() {
  return (
    <main className="narrow">
      <h1>Novo paciente</h1>
      <div className="card"><PatientForm /></div>
    </main>
  );
}
