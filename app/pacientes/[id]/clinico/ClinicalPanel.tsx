'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../_lib/api';
import AnthropometryHistory, { type Measurement } from './AnthropometryHistory';

type Field = {
  id: string; label: string; required: boolean;
  type: 'text' | 'number' | 'single' | 'multiple' | 'date';
  options?: string[];
};
type Template = { id: string; name: string; currentVersion: number };
type RecordRow = {
  id: string; templateId: string; templateVersion: number; status: 'DRAFT' | 'COMPLETED';
  answers: Record<string, unknown>; createdAt: string; completedAt?: string | null;
  versionSnapshot: { name: string; fields: Field[] };
};
export default function ClinicalPanel({ patientId }: { patientId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [fields, setFields] = useState<Field[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [compositionMethod, setCompositionMethod] = useState('');
  const [skinfoldSex, setSkinfoldSex] = useState('male');

  const base = `/api/patients/${patientId}`;
  const editing = records.find((r) => r.id === editingId);

  async function reload() {
    const [ts, rs, ms] = await Promise.all([
      api('/api/anamnesis/templates', undefined, 'GET'),
      api(`${base}/anamnesis`, undefined, 'GET'),
      api(`${base}/anthropometry`, undefined, 'GET'),
    ]);
    if (ts.status === 200) setTemplates(ts.data.items);
    if (rs.status === 200) setRecords(rs.data.items);
    if (ms.status === 200) setMeasurements(ms.data.items);
    if (rs.status === 409 || ms.status === 409) setMessage('Consentimento ausente ou revogado. O acesso clínico foi bloqueado.');
    else if ([ts.status, rs.status, ms.status].some((status) => status >= 300)) setMessage('Não foi possível carregar os dados clínicos.');
    setLoading(false);
  }

  useEffect(() => { void reload(); }, [patientId]);

  const formFields = useMemo(() => editing?.versionSnapshot.fields ?? fields, [editing, fields]);

  async function chooseTemplate(id: string) {
    setTemplateId(id);
    setEditingId(null);
    setAnswers({});
    setMessage('');
    if (!id) return setFields([]);
    const r = await api(`/api/anamnesis/templates/${id}`, undefined, 'GET');
    const versions = r.data?.template?.versions ?? [];
    setFields(versions[versions.length - 1]?.fields ?? []);
  }

  function editRecord(row: RecordRow) {
    setEditingId(row.id);
    setTemplateId(row.templateId);
    setFields(row.versionSnapshot.fields);
    setAnswers(row.answers ?? {});
    setMessage('');
  }

  function changeAnswer(field: Field, value: unknown) {
    setAnswers((current) => {
      const next = { ...current };
      if (value === '' || value === undefined) delete next[field.id];
      else next[field.id] = value;
      return next;
    });
  }

  async function saveAnamnesis(status: 'DRAFT' | 'COMPLETED') {
    const payload = editingId ? { answers, status } : { templateId, answers, status };
    const r = editingId
      ? await api(`${base}/anamnesis/${editingId}`, payload, 'PATCH')
      : await api(`${base}/anamnesis`, payload);
    if (r.status >= 300) {
      const code = r.data?.error?.code;
      setMessage(code === 'consent_required' ? 'Consentimento ausente ou revogado.' :
        code === 'validation' ? 'Confira os campos obrigatórios e os valores informados.' : 'Não foi possível salvar a anamnese.');
      return;
    }
    setMessage(status === 'COMPLETED' ? 'Anamnese concluída.' : 'Rascunho salvo.');
    setEditingId(r.data.record.id);
    await reload();
  }

  async function saveMeasurement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = (name: string) => {
      const entry = form.get(name);
      return entry === null || entry === '' ? undefined : Number(entry);
    };
    const method = String(form.get('bodyCompositionMethod') ?? '');
    const bodyComposition = method === 'BIOIMPEDANCE'
      ? {
        method,
        bodyFatPercent: value('bodyFatPercent'),
        ...(form.get('deviceModel') ? { deviceModel: String(form.get('deviceModel')) } : {}),
      }
      : method === 'JACKSON_POLLOCK_3_SITE'
        ? {
          method,
          sexAtBirth: String(form.get('sexAtBirth')),
          ageYears: value('ageYears'),
          ...(value('chestMm') !== undefined ? { chestMm: value('chestMm') } : {}),
          ...(value('abdomenMm') !== undefined ? { abdomenMm: value('abdomenMm') } : {}),
          ...(value('thighMm') !== undefined ? { thighMm: value('thighMm') } : {}),
          ...(value('tricepsMm') !== undefined ? { tricepsMm: value('tricepsMm') } : {}),
          ...(value('suprailiacMm') !== undefined ? { suprailiacMm: value('suprailiacMm') } : {}),
        }
        : undefined;
    const body = {
      weight: Number(form.get('weight')), weightUnit: form.get('weightUnit'),
      height: Number(form.get('height')), heightUnit: form.get('heightUnit'),
      measuredAt: form.get('measuredAt') ? new Date(`${form.get('measuredAt')}T12:00:00-03:00`).toISOString() : undefined,
      waistCm: form.get('waistCm') ? Number(form.get('waistCm')) : undefined,
      hipCm: form.get('hipCm') ? Number(form.get('hipCm')) : undefined,
      neckCm: form.get('neckCm') ? Number(form.get('neckCm')) : undefined,
      armCm: form.get('armCm') ? Number(form.get('armCm')) : undefined,
      thighCm: form.get('thighCm') ? Number(form.get('thighCm')) : undefined,
      bodyComposition,
    };
    const r = await api(`${base}/anthropometry`, body);
    if (r.status >= 300) return setMessage(r.data?.error?.code === 'validation'
      ? 'Confira o peso, altura, percentual de gordura e as medidas informadas.'
      : 'Não foi possível registrar as medidas.');
    formElement.reset();
    setCompositionMethod('');
    setSkinfoldSex('male');
    setMessage('Antropometria registrada.');
    await reload();
  }

  if (loading) return <p>Carregando prontuário…</p>;

  return (
    <>
      {message && <p role="status" className="muted">{message}</p>}
      <section className="card">
        <h2>Anamnese</h2>
        {templates.length === 0 ? <p>Cadastre um <a href="/anamnese">modelo de anamnese</a> para iniciar.</p> : <>
          <label>Modelo
            <select value={templateId} onChange={(e) => void chooseTemplate(e.target.value)}>
              <option value="">Selecione…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · v{t.currentVersion}</option>)}
            </select>
          </label>
          {formFields.map((field) => {
            const value = answers[field.id];
            return <div key={field.id}>
              <label>{field.label}{field.required ? ' *' : ''}
                {field.type === 'text' && <textarea maxLength={5000} value={typeof value === 'string' ? value : ''} onChange={(e) => changeAnswer(field, e.target.value)} />}
                {field.type === 'number' && <input type="number" step="any" value={typeof value === 'number' ? value : ''} onChange={(e) => changeAnswer(field, e.target.value === '' ? undefined : Number(e.target.value))} />}
                {field.type === 'date' && <input type="date" value={typeof value === 'string' ? value : ''} onChange={(e) => changeAnswer(field, e.target.value)} />}
                {field.type === 'single' && <select value={typeof value === 'string' ? value : ''} onChange={(e) => changeAnswer(field, e.target.value)}>
                  <option value="">Selecione…</option>{field.options?.map((option) => <option key={option}>{option}</option>)}
                </select>}
              </label>
              {field.type === 'multiple' && <fieldset><legend>{field.label}{field.required ? ' *' : ''}</legend>
                {field.options?.map((option) => {
                  const selected = Array.isArray(value) && value.includes(option);
                  return <label key={option}><input type="checkbox" checked={selected} onChange={() => {
                    const current = Array.isArray(value) ? value as string[] : [];
                    changeAnswer(field, selected ? current.filter((v) => v !== option) : [...current, option]);
                  }} /> {option}</label>;
                })}
              </fieldset>}
            </div>;
          })}
          <button type="button" disabled={!templateId} onClick={() => void saveAnamnesis(editing?.status === 'COMPLETED' ? 'COMPLETED' : 'DRAFT')}>Salvar rascunho</button>{' '}
          {editing?.status !== 'COMPLETED' && <button type="button" disabled={!templateId} onClick={() => void saveAnamnesis('COMPLETED')}>Concluir</button>}{' '}
          {editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setAnswers({}); void chooseTemplate(''); }}>Nova anamnese</button>}
        </>}
        <h3>Histórico</h3>
        {records.length ? <ul>{records.map((record) => <li key={record.id}>
          <button type="button" className="secondary" onClick={() => editRecord(record)}>
            {record.versionSnapshot.name} · v{record.templateVersion} · {record.status === 'DRAFT' ? 'rascunho' : 'concluída'} · {new Date(record.createdAt).toLocaleDateString('pt-BR')}
          </button>
        </li>)}</ul> : <p>Nenhuma anamnese registrada.</p>}
      </section>

      <section className="card">
        <h2>Antropometria</h2>
        <form onSubmit={saveMeasurement}>
          <label>Data<input type="date" name="measuredAt" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label>Peso<input required type="number" name="weight" min="1" max="1100" step="any" /></label>
          <label>Unidade do peso<select name="weightUnit"><option value="kg">kg</option><option value="lb">lb</option></select></label>
          <label>Altura<input required type="number" name="height" min="0.3" max="250" step="any" /></label>
          <label>Unidade da altura<select name="heightUnit"><option value="cm">cm</option><option value="m">m</option></select></label>
          <p>Medidas opcionais em centímetros:</p>
          <label>Cintura<input type="number" name="waistCm" min="10" max="300" step="any" /></label>
          <label>Quadril<input type="number" name="hipCm" min="10" max="300" step="any" /></label>
          <label>Pescoço<input type="number" name="neckCm" min="10" max="300" step="any" /></label>
          <label> braço<input type="number" name="armCm" min="10" max="300" step="any" /></label>
          <label>Coxa<input type="number" name="thighCm" min="10" max="300" step="any" /></label>
          <fieldset>
            <legend>Composição corporal (opcional)</legend>
            <label>Método
              <select name="bodyCompositionMethod" value={compositionMethod} onChange={(event) => setCompositionMethod(event.target.value)}>
                <option value="">Não informar</option>
                <option value="BIOIMPEDANCE">Leitura de bioimpedância</option>
                <option value="JACKSON_POLLOCK_3_SITE">Dobras cutâneas · Jackson–Pollock 3 sítios + Siri</option>
              </select>
            </label>
            {compositionMethod === 'BIOIMPEDANCE' && <>
              <label>Gordura corporal lida no equipamento (%)<input required type="number" name="bodyFatPercent" min="0" max="75" step="0.1" /></label>
              <label>Modelo do equipamento (opcional)<input type="text" name="deviceModel" maxLength={100} /></label>
              <p className="muted">Informe a leitura do equipamento; o sistema não estima esse percentual por bioimpedância.</p>
            </>}
            {compositionMethod === 'JACKSON_POLLOCK_3_SITE' && <>
              <label>Sexo usado pela equação
                <select required name="sexAtBirth" value={skinfoldSex} onChange={(event) => setSkinfoldSex(event.target.value)}>
                  <option value="male">Masculino</option><option value="female">Feminino</option>
                </select>
              </label>
              <label>Idade (anos)<input required type="number" name="ageYears" min="18" max="100" step="1" /></label>
              <p>Dobras em milímetros. Informe os três sítios correspondentes ao sexo selecionado; a equação não se aplica abaixo de 18 anos.</p>
              {skinfoldSex === 'male' ? <>
                <label>Peitoral (mm)<input required type="number" name="chestMm" min="2" max="80" step="0.1" /></label>
                <label>Abdominal (mm)<input required type="number" name="abdomenMm" min="2" max="80" step="0.1" /></label>
              </> : <>
                <label>Tríceps (mm)<input required type="number" name="tricepsMm" min="2" max="80" step="0.1" /></label>
                <label>Supra-ilíaca (mm)<input required type="number" name="suprailiacMm" min="2" max="80" step="0.1" /></label>
              </>}
              <label>Coxa (mm)<input required type="number" name="thighMm" min="2" max="80" step="0.1" /></label>
              <p className="muted">A fórmula usa peitoral, abdominal e coxa para homens; tríceps, supra-ilíaca e coxa para mulheres.</p>
            </>}
          </fieldset>
          <button type="submit">Registrar medidas</button>
        </form>
        <p className="muted">O IMC é calculado automaticamente. A classificação não é apresentada: a ficha não contém idade e crianças/adolescentes exigem curvas pediátricas adequadas. Dobras cutâneas fornecem uma estimativa adulta e dependem da técnica de medição; não substituem avaliação clínica.</p>
        <AnthropometryHistory measurements={measurements} />
      </section>
    </>
  );
}
