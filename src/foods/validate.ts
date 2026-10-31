export interface FoodValues {
  energyKcal?: number | null;
  proteinG?: number | null;
  carbG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
}

export interface Validation {
  errors: string[]; // impedem salvar/importar
  warnings: string[]; // pedem confirmação do profissional
}

const num = (v: number | null | undefined) => (typeof v === 'number' ? v : null);

/** Valores por 100 g. Nulo = "não informado" e nunca é tratado como zero. */
export function validateFoodValues(v: FoodValues): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const e = num(v.energyKcal), p = num(v.proteinG), c = num(v.carbG), f = num(v.fatG), fi = num(v.fiberG);

  for (const [k, x] of Object.entries({ energyKcal: e, proteinG: p, carbG: c, fatG: f, fiberG: fi })) {
    if (x !== null && (!Number.isFinite(x) || x < 0)) errors.push(`${k}_invalid`);
  }
  if (errors.length) return { errors, warnings };

  const macros = (p ?? 0) + (c ?? 0) + (f ?? 0);
  if (macros > 100.5) warnings.push('macros_exceed_100g');
  if (e !== null && e > 900) warnings.push('energy_implausible'); // máximo teórico: 100 g de gordura pura
  if (fi !== null && c !== null && fi > c) warnings.push('fiber_exceeds_carb');
  if (e !== null && p !== null && c !== null && f !== null) {
    const calc = 4 * p + 4 * c + 9 * f;
    if (Math.abs(e - calc) > Math.max(20, 0.35 * calc)) warnings.push('energy_mismatch');
  }
  return { errors, warnings };
}

/** Converte um valor informado por porção para 100 g. */
export function toPer100g(value: number, portionGrams: number): number {
  if (!(portionGrams > 0)) throw new Error('porção inválida');
  return Number(((value * 100) / portionGrams).toFixed(3));
}
