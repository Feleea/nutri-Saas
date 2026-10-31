'use client';

import { useState } from 'react';
import { api } from '../_lib/api';

export default function LogoSettingsForm({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [savedUrl, setSavedUrl] = useState(initialUrl);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');
    const next = url.trim() || null;
    const result = await api('/api/brand', { logoUrl: next });
    if (result.status !== 200) {
      setError('Use um endereço HTTPS válido para a imagem.');
      return;
    }
    setUrl(result.data.logoUrl ?? '');
    setSavedUrl(result.data.logoUrl ?? null);
    setMessage('Identidade visual atualizada.');
  }

  return (
    <section className="card">
      <form onSubmit={submit}>
        <label htmlFor="logoUrl">URL pública do logotipo (HTTPS)</label>
        <input id="logoUrl" name="logoUrl" type="url" maxLength={2048} value={url}
          onChange={(event) => setUrl(event.target.value)} placeholder="https://exemplo.com/logo.png" />
        <p className="muted">O logotipo aparece no cabeçalho dos planos alimentares impressos ou salvos em PDF.</p>
        <button type="submit">Salvar logotipo</button>
        {url && <button type="button" className="secondary" onClick={() => { setUrl(''); setError(''); setMessage(''); }}>Remover</button>}
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="ok" role="status">{message}</p>}
      </form>
      <div className="brand-preview">
        <h2>Pré-visualização</h2>
        {savedUrl ? <img src={savedUrl} alt="Logotipo configurado" referrerPolicy="no-referrer" /> : <p className="muted">Nenhum logotipo configurado.</p>}
      </div>
    </section>
  );
}
