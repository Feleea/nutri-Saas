'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../_lib/api';

interface PreviewRow {
  row: number;
  patient: { fullName: string; email?: string | null; phone?: string | null; cpf?: string | null; goal?: string | null; tags?: string[] | null };
  errors: string[];
}

interface Preview {
  rows: PreviewRow[];
  duplicateRows: number[];
  validCount: number;
}

const ERROR_TEXT: Record<string, string> = {
  name_required: 'nome obrigatório',
  name_too_long: 'nome muito longo',
  contact_required: 'informe telefone ou e-mail',
  email_invalid: 'e-mail inválido',
  phone_invalid: 'telefone inválido',
  cpf_invalid: 'CPF inválido',
  goal_too_long: 'objetivo muito longo',
  tags_invalid: 'etiquetas inválidas',
  column_count: 'quantidade de colunas diferente do cabeçalho',
};

const TEMPLATE = 'nome,email,telefone,cpf,objetivo,etiquetas\nAna Silva,ana@example.com,11999990000,52998224725,Saúde,"gestante; atleta"\n';

export default function PatientImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [working, setWorking] = useState(false);
  const [imported, setImported] = useState<number | null>(null);

  async function loadFile(file?: File) {
    setPreview(null);
    setError('');
    setImported(null);
    setConfirmDuplicates(false);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsv('');
      setFileName('');
      return setError('Selecione um arquivo CSV.');
    }
    if (file.size > 1_000_000) {
      setCsv('');
      setFileName('');
      return setError('O arquivo deve ter no máximo 1 MB.');
    }
    setCsv(await file.text());
    setFileName(file.name);
  }

  async function showPreview() {
    setWorking(true);
    setError('');
    setImported(null);
    const result = await api('/api/patients/import', { action: 'preview', csv });
    setWorking(false);
    if (result.status !== 200 || result.data?.error) {
      const code = result.data?.error?.code;
      setError(code === 'csv_too_large' ? 'O arquivo deve ter no máximo 1 MB.' : `Não foi possível ler o CSV (${code ?? 'erro'}).`);
      setPreview(null);
      return;
    }
    setPreview(result.data);
  }

  async function confirmImport() {
    if (!preview) return;
    setWorking(true);
    setError('');
    const result = await api('/api/patients/import', { action: 'confirm', csv, confirmDuplicates });
    setWorking(false);
    if (result.status === 201) {
      setImported(result.data.imported);
      router.refresh();
      return;
    }
    if (result.data?.error?.code === 'duplicate_cpf') {
      const refreshed = await api('/api/patients/import', { action: 'preview', csv });
      if (refreshed.status === 200 && !refreshed.data?.error) {
        setPreview(refreshed.data);
        setConfirmDuplicates(false);
      }
      setError('Há CPFs duplicados. Revise as linhas destacadas e marque a confirmação para continuar.');
      return;
    }
    if (result.data?.error?.code === 'validation') {
      setError(`A validação mudou. Execute a prévia novamente (linhas: ${(result.data.error.rows ?? []).join(', ')}).`);
      setPreview(null);
      return;
    }
    const code = result.data?.error?.code;
    setError(code === 'patient_limit'
      ? 'O limite do plano não comporta todos os pacientes deste arquivo. Nenhum paciente foi importado.'
      : code === 'access_restricted'
        ? 'Novos cadastros estão bloqueados pela situação da assinatura. Nenhum paciente foi importado.'
        : 'A importação não foi concluída. Nenhum paciente foi importado.');
  }

  const hasRowErrors = Boolean(preview?.rows.some((row) => row.errors.length));
  const hasDuplicates = Boolean(preview?.duplicateRows.length);

  return (
    <section>
      <p>Envie um arquivo CSV (máximo 1 MB e 200 pacientes). A prévia valida cada linha; nada será salvo até a confirmação.</p>
      <p>
        <a download="modelo-pacientes.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>
          Baixar modelo CSV
        </a>
      </p>
      <label htmlFor="patient-csv">Arquivo CSV</label>
      <input id="patient-csv" type="file" accept=".csv,text/csv" onChange={(event) => void loadFile(event.target.files?.[0])} />
      {fileName && <p className="muted">{fileName}</p>}
      {csv && <button type="button" disabled={working} onClick={() => void showPreview()}>{working ? 'Validando…' : 'Validar e visualizar'}</button>}
      {error && <p className="error" role="alert">{error}</p>}
      {preview && (
        <div>
          <h2>Prévia</h2>
          <p>{preview.validCount} linha(s) válida(s) de {preview.rows.length}.</p>
          {hasRowErrors && <p className="error">Corrija as linhas com erro antes de confirmar. Nenhum dado foi salvo.</p>}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Linha</th><th>Nome</th><th>E-mail</th><th>Telefone</th><th>CPF</th><th>Validação</th></tr></thead>
              <tbody>
                {preview.rows.map(({ row, patient, errors }) => {
                  const duplicate = preview.duplicateRows.includes(row);
                  return (
                    <tr key={row}>
                      <td>{row}</td><td>{patient.fullName}</td><td>{patient.email || '—'}</td>
                      <td>{patient.phone || '—'}</td><td>{patient.cpf || '—'}</td>
                      <td className={errors.length || duplicate ? 'error' : undefined}>
                        {[...errors.map((code) => ERROR_TEXT[code] ?? 'dado inválido'), ...(duplicate ? ['CPF duplicado'] : [])].join('; ') || 'OK'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasDuplicates && !hasRowErrors && (
            <label>
              <input type="checkbox" checked={confirmDuplicates} onChange={(event) => setConfirmDuplicates(event.target.checked)} />
              Confirmo que revisei os CPFs duplicados e quero prosseguir.
            </label>
          )}
          <p>
            <button type="button" disabled={working || imported !== null || hasRowErrors || (hasDuplicates && !confirmDuplicates)} onClick={() => void confirmImport()}>
              {working ? 'Importando…' : 'Confirmar importação'}
            </button>
          </p>
        </div>
      )}
      {imported !== null && <p role="status">{imported} paciente(s) importado(s) com sucesso. Nenhuma autorização de consentimento foi presumida; confira os avisos de consentimento na lista.</p>}
    </section>
  );
}
