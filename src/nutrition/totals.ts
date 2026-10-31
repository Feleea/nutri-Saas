export interface FoodItem {
  grams: number;
  /** Valor do nutriente por 100 g; null = "não informado". */
  per100g: number | null;
}

export interface NutrientTotal {
  value: number;
  /** false quando algum item não tinha o dado (nunca soma zero silenciosamente). */
  complete: boolean;
  missing: number;
}

export function sumNutrient(items: FoodItem[]): NutrientTotal {
  let value = 0;
  let missing = 0;
  for (const it of items) {
    if (it.per100g === null) {
      missing++;
      continue;
    }
    value += (it.grams * it.per100g) / 100;
  }
  return { value: Number(value.toFixed(3)), complete: missing === 0, missing };
}
