'use client';

import { useEffect, useMemo, useState } from 'react';
import { calculateNutrientTotals, type NutrientSnapshot, type NutrientTotals } from '@/src/meal-plans/nutrition';

type Measure = { id: string | null; label: string; grams: number };
type EditorItem = {
  foodId: string;
  foodName: string;
  quantity: number;
  measureId: string | null;
  measureLabel: string;
  measureGrams: number;
  nutrients: NutrientSnapshot;
  sourceCode: string | null;
  sourceName: string | null;
  sourceVersion: string | null;
  measures: Measure[];
};
type Meal = { name: string; time: string; items: EditorItem[] };
type VersionMeal = {
  id: string;
  name: string;
  time: string;
  sortOrder: number;
  items: (Omit<EditorItem, 'measures'> & { id: string; grams: number })[];
  totals: NutrientTotals;
};
type Version = {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  meals: VersionMeal[];
  totals: NutrientTotals;
};
type Plan = { id: string; title: string; createdAt: string; versions: Version[] };
type FoodHit = {
  id: string;
  name: string;
  source: { code: string; name: string; version: string } | null;
  energyKcal: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
  fiberG: number | null;
  micros: Record<string, number | null> | null;
};

const emptyMeal = (): Meal => ({ name: 'Refeição', time: '08:00', items: [] });
const quantityGrams = (item: EditorItem) => Number((item.quantity * item.measureGrams).toFixed(3));
const nutrientLabels: Record<string, string> = {
  energyKcal: 'Energia (kcal)', proteinG: 'Proteínas (g)', carbG: 'Carboidratos (g)',
  fatG: 'Gorduras (g)', fiberG: 'Fibras (g)',
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.code ?? 'Falha ao carregar dados');
  return data as T;
}

function showTotals(totals: NutrientTotals) {
  const keys = Object.keys(totals);
  if (!keys.length) return <p className="muted">Sem itens para calcular.</p>;
  return (
    <dl className="nutrition-totals">
      {keys.map((key) => {
        const total = totals[key];
        const label = nutrientLabels[key] ?? key;
        return <div key={key}><dt>{label}</dt><dd>{total.complete ? total.value : 'Não informado'}</dd></div>;
      })}
    </dl>
  );
}

export default function MealPlanWorkspace({ patientId }: { patientId: string }) {
  const base = `/api/patients/${encodeURIComponent(patientId)}/meal-plans`;
  const [plans, setPlans] = useState<{ id: string; title: string; createdAt: string; latest: Version | null }[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [title, setTitle] = useState('');
  const [meals, setMeals] = useState<Meal[]>([]);
  const [baseVersion, setBaseVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<FoodHit[]>([]);
  const [addingMeal, setAddingMeal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const visibleVersion = useMemo(
    () => selected?.versions.find((version) => version.version === historyVersion) ?? selected?.versions[0] ?? null,
    [selected, historyVersion],
  );

  async function loadPlans() {
    const data = await request<{ items: typeof plans }>(base);
    setPlans(data.items);
  }

  useEffect(() => {
    loadPlans().catch((e) => setError(e.message));
  // loadPlans intentionally uses the patient-scoped endpoint only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useEffect(() => {
    if (search.trim().length < 1) { setResults([]); return; }
    const timer = setTimeout(() => {
      request<{ results: FoodHit[] }>(`/api/foods/search?q=${encodeURIComponent(search.trim())}`)
        .then((data) => setResults(data.results))
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  function startNew() {
    setSelected(null);
    setIsEditing(true);
    setTitle('');
    setMeals([emptyMeal()]);
    setBaseVersion(0);
    setHistoryVersion(null);
    setError('');
  }

  async function openPlan(id: string) {
    setError('');
    try {
      const { plan } = await request<{ plan: Plan }>(`${base}/${encodeURIComponent(id)}`);
      setSelected(plan);
      setIsEditing(false);
      setHistoryVersion(plan.versions[0]?.version ?? null);
      setTitle(plan.title);
      setBaseVersion(plan.versions[0]?.version ?? 0);
      setMeals([]);
    } catch (e) { setError((e as Error).message); }
  }

  async function hydrateMeals(source: VersionMeal[]): Promise<Meal[]> {
    return Promise.all(source.map(async (meal) => ({
      name: meal.name,
      time: meal.time,
      items: await Promise.all(meal.items.map(async (item) => {
        const options = await request<{ measures: Measure[] }>(`/api/foods/${encodeURIComponent(item.foodId)}/measures/options`)
          .then((data) => data.measures);
        return {
          foodId: item.foodId, foodName: item.foodName, quantity: item.quantity,
          measureId: item.measureId, measureLabel: item.measureLabel, measureGrams: item.measureGrams,
          nutrients: item.nutrients, sourceCode: item.sourceCode, sourceName: item.sourceName,
          sourceVersion: item.sourceVersion, measures: options,
        };
      })),
    })));
  }

  async function editLatestVersion() {
    if (!selected?.versions[0]) return;
    setError('');
    try {
      setMeals(await hydrateMeals(selected.versions[0].meals));
      setTitle(selected.title);
      setBaseVersion(selected.versions[0].version);
      setIsEditing(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function updateMeal(index: number, patch: Partial<Meal>) {
    setMeals((previous) => previous.map((meal, i) => i === index ? { ...meal, ...patch } : meal));
  }

  function updateItem(mealIndex: number, itemIndex: number, patch: Partial<EditorItem>) {
    setMeals((previous) => previous.map((meal, i) => i !== mealIndex ? meal : {
      ...meal, items: meal.items.map((item, j) => j === itemIndex ? { ...item, ...patch } : item),
    }));
  }

  async function addFood(hit: FoodHit) {
    const mealIndex = addingMeal;
    if (mealIndex === null) return;
    try {
      const [foodData, measureData] = await Promise.all([
        request<{ results: FoodHit[] }>(
          `/api/foods/search?q=${encodeURIComponent(hit.name)}`,
        ),
        request<{ measures: Measure[] }>(`/api/foods/${encodeURIComponent(hit.id)}/measures/options`),
      ]);
      const selectedFood = foodData.results.find((food) => food.id === hit.id);
      if (!selectedFood) throw new Error('Alimento não encontrado na busca');
      setMeals((previous) => previous.map((meal, i) => i !== mealIndex ? meal : {
        ...meal,
        items: [...meal.items, {
          foodId: hit.id, foodName: hit.name, quantity: 100, measureId: null,
          measureLabel: 'g', measureGrams: 1,
          nutrients: {
            energyKcal: selectedFood.energyKcal,
            proteinG: selectedFood.proteinG,
            carbG: selectedFood.carbG,
            fatG: selectedFood.fatG,
            fiberG: selectedFood.fiberG,
            ...(selectedFood.micros ?? {}),
          },
          sourceCode: hit.source?.code ?? null, sourceName: hit.source?.name ?? null,
          sourceVersion: hit.source?.version ?? null, measures: measureData.measures,
        }],
      }));
      setSearch('');
      setResults([]);
      setAddingMeal(null);
    } catch (e) { setError((e as Error).message); }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload = {
        title,
        meals: meals.map((meal) => ({
          name: meal.name, time: meal.time,
          items: meal.items.map((item) => ({
            foodId: item.foodId, quantity: item.quantity, measureId: item.measureId,
          })),
        })),
      };
      if (selected) {
        await request(`${base}/${encodeURIComponent(selected.id)}`, {
          method: 'PUT', body: JSON.stringify({ ...payload, baseVersion }),
        });
        await openPlan(selected.id);
      } else {
        const created = await request<{ plan: { id: string } }>(base, { method: 'POST', body: JSON.stringify(payload) });
        await loadPlans();
        await openPlan(created.plan.id);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const currentTotals = calculateNutrientTotals(meals.flatMap((meal) =>
    meal.items.map((item) => ({ grams: quantityGrams(item), nutrients: item.nutrients })),
  ));

  return (
    <section className="meal-plan-workspace">
      {error && <p className="error" role="alert">{error}</p>}
      {!selected && !meals.length && (
        <div className="card">
          <h2>Planos alimentares</h2>
          <button type="button" className="btn" onClick={startNew}>Criar plano</button>
          {plans.length ? <ul>{plans.map((plan) => (
            <li key={plan.id}><button className="link-button" type="button" onClick={() => openPlan(plan.id)}>{plan.title}</button></li>
          ))}</ul> : <p className="muted">Nenhum plano salvo.</p>}
        </div>
      )}
      {selected && !isEditing && (
        <div className="card">
          <h2>{visibleVersion?.title ?? selected.title}</h2>
          {selected.versions.map((version) => (
            <button key={version.id} type="button" className={historyVersion === version.version ? 'btn' : 'btn secondary'}
              onClick={() => setHistoryVersion(version.version)} aria-pressed={historyVersion === version.version}>
              Versão {version.version}
            </button>
          ))}
          <p>Versão {visibleVersion?.version ?? '—'}</p>
          {visibleVersion?.meals.map((meal) => (
            <div className="card" key={meal.id}>
              <h3>{meal.time} · {meal.name}</h3>
              <ul>{meal.items.map((item) => <li key={item.id}>{item.foodName}: {item.quantity} {item.measureLabel} ({item.grams} g)</li>)}</ul>
              {showTotals(meal.totals)}
            </div>
          ))}
          {visibleVersion && <><h3>Total do dia</h3>{showTotals(visibleVersion.totals)}</>}
          {historyVersion === selected.versions[0]?.version && (
            <button className="btn secondary" type="button" onClick={editLatestVersion}>Editar como nova versão</button>
          )}
          <button className="btn secondary" type="button" onClick={() => { setSelected(null); setMeals([]); }}>Voltar</button>
        </div>
      )}
      {isEditing && (
        <div className="card">
          <h2>{selected ? 'Nova versão do plano' : 'Novo plano alimentar'}</h2>
          <label>Título <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
          {meals.map((meal, mealIndex) => {
            const mealTotals = calculateNutrientTotals(meal.items.map((item) => ({ grams: quantityGrams(item), nutrients: item.nutrients })));
            return (
              <section className="meal-editor" key={mealIndex}>
                <div className="meal-heading">
                  <label>Refeição <input value={meal.name} maxLength={80} onChange={(e) => updateMeal(mealIndex, { name: e.target.value })} /></label>
                  <label>Horário <input type="time" value={meal.time} onChange={(e) => updateMeal(mealIndex, { time: e.target.value })} /></label>
                  <button className="btn secondary" type="button" onClick={() => setMeals((prev) => prev.filter((_, i) => i !== mealIndex))}>Remover refeição</button>
                </div>
                {meal.items.map((item, itemIndex) => (
                  <div className="meal-item" key={`${item.foodId}-${itemIndex}`}>
                    <strong>{item.foodName}</strong>
                    <span className="muted">{item.sourceName ? `${item.sourceName} ${item.sourceVersion ?? ''}` : 'Alimento próprio'}</span>
                    <label>Quantidade <input type="number" min="0.001" step="0.001" value={item.quantity}
                      onChange={(e) => updateItem(mealIndex, itemIndex, { quantity: Number(e.target.value) })} /></label>
                    <label>Medida <select value={item.measureId ?? ''} onChange={(e) => {
                      const measure = item.measures.find((option) => option.id === (e.target.value || null));
                      if (measure) updateItem(mealIndex, itemIndex, { measureId: measure.id, measureLabel: measure.label, measureGrams: measure.grams });
                    }}>{item.measures.map((measure, i) => <option key={measure.id ?? `g-${i}`} value={measure.id ?? ''}>{measure.label}{measure.label !== 'g' ? ` (${measure.grams} g)` : ''}</option>)}</select></label>
                    <span>{quantityGrams(item)} g</span>
                    <button className="btn secondary" type="button" onClick={() => updateMeal(mealIndex, { items: meal.items.filter((_, i) => i !== itemIndex) })}>Remover</button>
                  </div>
                ))}
                <button className="btn secondary" type="button" onClick={() => { setAddingMeal(mealIndex); setSearch(''); setResults([]); }}>Adicionar alimento</button>
                {addingMeal === mealIndex && (
                  <div className="food-search">
                    <label>Buscar alimento <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} /></label>
                    {results.length > 0 && <ul>{results.map((hit) => (
                      <li key={hit.id}><button className="link-button" type="button" onClick={() => addFood(hit)}>
                        {hit.name}{hit.source ? ` · ${hit.source.name} ${hit.source.version}` : ' · próprio'}
                      </button></li>
                    ))}</ul>}
                    <button type="button" className="btn secondary" onClick={() => setAddingMeal(null)}>Cancelar</button>
                  </div>
                )}
                <h4>Totais da refeição</h4>{showTotals(mealTotals)}
              </section>
            );
          })}
          <button className="btn secondary" type="button" onClick={() => setMeals((prev) => [...prev, { ...emptyMeal(), name: `Refeição ${prev.length + 1}`, time: '12:00' }])}>Adicionar refeição</button>
          <h3>Total do dia</h3>{showTotals(currentTotals)}
          <div className="meal-actions">
            <button className="btn" type="button" disabled={busy || !title.trim() || meals.some((meal) => !meal.items.length)} onClick={save}>
              {busy ? 'Salvando…' : selected ? 'Salvar nova versão' : 'Salvar plano'}
            </button>
            <button className="btn secondary" type="button" onClick={() => {
              if (selected) { setIsEditing(false); setMeals([]); }
              else { setSelected(null); setMeals([]); setIsEditing(false); }
            }}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
