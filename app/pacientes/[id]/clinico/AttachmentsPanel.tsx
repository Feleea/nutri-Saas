'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../_lib/api';

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsPanel({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const base = `/api/patients/${patientId}/attachments`;

  async function reload() {
    const result = await api(base, undefined, 'GET');
    if (result.status === 200) setItems(result.data.items);
    else setMessage(result.data?.error?.code === 'consent_required'
      ? 'Consentimento ausente ou revogado. O acesso aos anexos foi bloqueado.'
      : 'Não foi possível carregar os anexos.');
    setLoading(false);
  }

  useEffect(() => { void reload(); }, [patientId]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (new FormData(form).get('file')) as File | null;
    if (!file) return setMessage('Selecione um arquivo.');
    if (file.size > MAX_BYTES) return setMessage('O arquivo deve ter no máximo 10 MB.');
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64: base64(new Uint8Array(await file.arrayBuffer())) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(data?.error?.code === 'consent_required' ? 'Consentimento ausente ou revogado.' :
          data?.error?.code === 'invalid_attachment' ? 'Use um PDF, JPEG ou PNG válido.' :
            data?.error?.code === 'attachment_too_large' ? 'O arquivo deve ter no máximo 10 MB.' :
              'Não foi possível enviar o anexo.');
        return;
      }
      form.reset();
      setMessage('Anexo enviado com segurança.');
      await reload();
    } catch {
      setMessage('Não foi possível enviar o anexo.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Attachment) {
    if (!window.confirm(`Excluir o anexo “${item.fileName}”?`)) return;
    setBusy(true);
    const result = await api(`${base}/${item.id}`, undefined, 'DELETE');
    if (result.status >= 300) setMessage('Não foi possível excluir o anexo.');
    else {
      setMessage('Anexo excluído.');
      await reload();
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <h2>Anexos clínicos</h2>
      <p className="muted">PDF, JPEG ou PNG · até 10 MB por arquivo. Os arquivos são armazenados criptografados.</p>
      <form onSubmit={(event) => void upload(event)}>
        <label>Arquivo
          <input type="file" name="file" accept={ACCEPT} disabled={busy} />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Aguarde…' : 'Enviar anexo'}</button>
      </form>
      {message && <p role="status" className="muted">{message}</p>}
      {loading ? <p>Carregando anexos…</p> : items.length === 0 ? <p>Nenhum anexo.</p> : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a href={`${base}/${item.id}/download`}>{item.fileName}</a>
              <span className="muted"> · {formatSize(item.sizeBytes)}</span>{' '}
              <button type="button" className="secondary" disabled={busy} onClick={() => void remove(item)}>Excluir</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
