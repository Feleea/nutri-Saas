'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../_lib/api';

type Field = { id: string; label: string; type: 'text' | 'number' | 'single' | 'multiple' | 'date'; required: boolean; options?: string[] };
type Template = { id: string; name: string; currentVersion: number; versions?: { version: number; name: string; fields: unknown }[] };
export type TemplateSummary = { id: string; name: string; currentVersion: number };
const INITIAL: Field[] = [{ id: 'motivo', label: 'Motivo da consulta', type: 'text', required: true }];

export default function TemplateManager({ initialTemplates }: { initialTemplates: TemplateSummary[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Field[]>(INITIAL);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');

  async function edit(template?: Template) {
    setMessage('');
    if (!template) {
      setEditing(null); setName(''); setFields(INITIAL); setChoices({});
      return;
    }
    const r = await api(`/api/anamnesis/templates/${template.id}`, undefined, 'GET');
    const versions = r.data?.template?.versions ?? [];
    const current = versions[versions.length - 1];
    if (r.status !== 200 || !current) return setMessage('Não foi possível abrir o modelo.');
    setEditing({ ...template, versions });
    setName(current.name);
    setFields(current.fields as Field[]);
    setChoices(Object.fromEntries(current.fields.map((f: Field, i: number) => [i, f.options?.join(', ') ?? ''])));
  }

  function setField(index: number, patch: Partial<Field>) {
    setFields((current) => current.map((field, i) => i === index ? { ...field, ...patch } : field));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      fields: fields.map((field, index) => {
        const { options: _options, ...base } = field;
        const isChoice = field.type === 'single' || field.type === 'multiple';
        return isChoice ? { ...base, options: (choices[index] ?? '').split(',').map((v) => v.trim()).filter(Boolean) } : base;
      }),
    };
    const r = editing
      ? await api(`/api/anamnesis/templates/${editing.id}`, payload, 'PATCH')
      : await api('/api/anamnesis/templates', payload);
    if (r.status >= 300) return setMessage('Revise o nome, os campos e as opções obrigatórias.');
    setMessage(editing ? 'Nova versão salva.' : 'Modelo criado.');
    setEditing(null);
    setName('');
    setFields(INITIAL);
    const refreshed = await api('/api/anamnesis/templates', undefined, 'GET');
    if (refreshed.status === 200) setTemplates(refreshed.data.items);
    router.refresh();
  }

  return (
    <>
      <section className="card">
        <h2>Modelos disponíveis</h2>
        {templates.length ? <ul>
          {templates.map((template) => <li key={template.id}>
            {template.name} · v{template.currentVersion}{' '}
            <button type="button" className="secondary" onClick={() => edit(template)}>Criar nova versão</button>
          </li>)}
        </ul> : <p>Nenhum modelo cadastrado.</p>}
        <button type="button" onClick={() => edit()}>Criar modelo</button>
      </section>
      <form className="card" onSubmit={submit}>
        <h2>{editing ? `Nova versão: ${editing.name}` : 'Editor de modelo'}</h2>
        <label>Nome do modelo<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        {fields.map((field, index) => <fieldset key={index}>
          <legend>Campo {index + 1}</legend>
          <label>Rótulo<input required maxLength={160} value={field.label} onChange={(e) => setField(index, { label: e.target.value })} /></label>
          <label>Identificador<input required pattern="[A-Za-z0-9_-]+" value={field.id} onChange={(e) => setField(index, { id: e.target.value })} /></label>
          <label>Tipo<select value={field.type} onChange={(e) => setField(index, { type: e.target.value as Field['type'] })}>
            <option value="text">Texto</option><option value="number">Número</option><option value="single">Escolha única</option>
            <option value="multiple">Múltipla escolha</option><option value="date">Data</option>
          </select></label>
          {(field.type === 'single' || field.type === 'multiple') && <label>Opções separadas por vírgula
            <input required value={choices[index] ?? ''} onChange={(e) => setChoices((current) => ({ ...current, [index]: e.target.value }))} />
          </label>}
          <label><input type="checkbox" checked={field.required} onChange={(e) => setField(index, { required: e.target.checked })} /> Obrigatório</label>
          {fields.length > 1 && <button type="button" className="secondary" onClick={() => setFields((current) => current.filter((_, i) => i !== index))}>Remover campo</button>}
        </fieldset>)}
        <button type="button" className="secondary" disabled={fields.length >= 60} onClick={() => setFields((current) => {
          let n = 1;
          while (current.some((field) => field.id === `campo_${n}`)) n += 1;
          return [...current, { id: `campo_${n}`, label: '', type: 'text', required: false }];
        })}>Adicionar campo</button>{' '}
        <button type="submit">Salvar {editing ? 'nova versão' : 'modelo'}</button>
        {message && <p role="status">{message}</p>}
      </form>
    </>
  );
}
