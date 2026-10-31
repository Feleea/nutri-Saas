'use client';

import { useState } from 'react';

type Food = { id: string; name: string };
type Ingredient = { food: Food; grams: number };
type SearchResult = { id: string; name: string };
type RequestError = Error & { payload?: { error?: { needsConfirm?: boolean; warnings?: string[] } } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data?.error?.code ?? 'Falha ao salvar'), { payload: data });
  return data as T;
}

export default function RecipeManager() {
  const [name, setName] = useState('');
  const [yieldGrams, setYieldGrams] = useState(100);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [foodName, setFoodName] = useState('');
  const [foodValues, setFoodValues] = useState({ energyKcal: '', proteinG: '', carbG: '', fatG: '', fiberG: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function search(value: string) {
    setQuery(value);
    if (!value.trim()) { setResults([]); return; }
    try {
      const data = await request<{ results: SearchResult[] }>(`/api/foods/search?q=${encodeURIComponent(value.trim())}`);
      setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save(confirm = false) {
    setBusy(true);
    setError('');
    setMessage('');
    setNeedsConfirm(false);
    try {
      const result = await request<{ id: string; name: string; warnings: string[] }>('/api/foods/recipes', {
        method: 'POST',
        body: JSON.stringify({
          name, yieldGrams,
          ingredients: ingredients.map(({ food, grams }) => ({ foodId: food.id, grams })),
          ...(confirm ? { confirm: true } : {}),
        }),
      });
      setMessage(`Receita "${result.name}" salva no seu catálogo de alimentos.`);
      setName('');
      setIngredients([]);
    } catch (e) {
      const failure = e as RequestError;
      setError(failure.payload?.error?.warnings?.join(', ') ?? failure.message);
      setNeedsConfirm(Boolean(failure.payload?.error?.needsConfirm));
    } finally { setBusy(false); }
  }

  async function saveCustomFood(confirm = false) {
    setBusy(true);
    setError('');
    setMessage('');
    setNeedsConfirm(false);
    try {
      const values = Object.fromEntries(Object.entries(foodValues).map(([key, raw]) => [
        key, raw.trim() ? Number(raw) : null,
      ]));
      const result = await request<{ id: string; name: string; warnings: string[] }>('/api/foods', {
        method: 'POST',
        body: JSON.stringify({ name: foodName, per: '100g', values, ...(confirm ? { confirm: true } : {}) }),
      });
      setMessage(`Alimento "${result.name}" salvo no seu catálogo.`);
      setFoodName('');
      setFoodValues({ energyKcal: '', proteinG: '', carbG: '', fatG: '', fiberG: '' });
    } catch (e) {
      const failure = e as RequestError;
      setError(failure.payload?.error?.warnings?.join(', ') ?? failure.message);
      setNeedsConfirm(Boolean(failure.payload?.error?.needsConfirm));
    } finally { setBusy(false); }
  }

  return (
    <>
      <section className="card">
        <h2>Cadastrar alimento próprio</h2>
        <p className="muted">Informe os valores nutricionais por 100 g. Campos vazios permanecem como “não informado”.</p>
        <label>Nome <input value={foodName} maxLength={160} onChange={(e) => setFoodName(e.target.value)} /></label>
        {Object.keys(foodValues).map((key) => (
          <label key={key}>{({ energyKcal: 'Energia (kcal)', proteinG: 'Proteínas (g)', carbG: 'Carboidratos (g)', fatG: 'Gorduras (g)', fiberG: 'Fibras (g)' } as Record<string, string>)[key]}
            <input type="number" min="0" step="0.001" value={foodValues[key as keyof typeof foodValues]}
              onChange={(e) => setFoodValues((previous) => ({ ...previous, [key]: e.target.value }))} />
          </label>
        ))}
        <button type="button" disabled={busy || !foodName.trim()} onClick={() => void saveCustomFood()}>Salvar alimento</button>
        {needsConfirm && <button type="button" className="btn secondary" disabled={busy} onClick={() => void saveCustomFood(true)}>Confirmar avisos e salvar</button>}
      </section>
      <section className="card">
        <h2>Criar receita</h2>
        <p className="muted">Informe o peso final da preparação e os ingredientes em gramas. Os nutrientes são calculados por 100 g do rendimento.</p>
        <label>Nome da receita <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
        <label>Rendimento final (g) <input type="number" min="0.001" step="0.001" value={yieldGrams} onChange={(e) => setYieldGrams(Number(e.target.value))} /></label>
        <label>Buscar ingrediente <input value={query} onChange={(e) => { setError(''); void search(e.target.value); }} /></label>
        {results.length > 0 && <ul>{results.map((food) => (
          <li key={food.id}>
            <button type="button" className="link-button" onClick={() => {
              setIngredients((previous) => [...previous, { food, grams: 100 }]);
              setQuery('');
              setResults([]);
            }}>{food.name}</button>
          </li>
        ))}</ul>}
        {ingredients.map((ingredient, index) => (
          <div className="meal-item" key={`${ingredient.food.id}-${index}`}>
            <strong>{ingredient.food.name}</strong>
            <label>Quantidade (g) <input type="number" min="0.001" step="0.001" value={ingredient.grams}
              onChange={(e) => setIngredients((previous) => previous.map((item, i) => i === index ? { ...item, grams: Number(e.target.value) } : item))} /></label>
            <button type="button" className="btn secondary" onClick={() => setIngredients((previous) => previous.filter((_, i) => i !== index))}>Remover</button>
          </div>
        ))}
        <button type="button" disabled={busy || !name.trim() || !ingredients.length} onClick={() => void save()}>Salvar receita</button>
        {needsConfirm && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save(true)}>Confirmar avisos e salvar</button>}
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok" role="status">{message}</p>}
    </>
  );
}
