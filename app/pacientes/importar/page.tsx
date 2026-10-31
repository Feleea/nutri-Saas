import Link from 'next/link';
import PatientImportForm from './PatientImportForm';

export default function ImportarPacientes() {
  return (
    <main>
      <h1>Importar pacientes</h1>
      <p><Link href="/pacientes">Voltar à lista de pacientes</Link></p>
      <PatientImportForm />
    </main>
  );
}
