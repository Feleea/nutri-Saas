import { sumNutrient } from '../nutrition/totals';

export type NutrientSnapshot = Record<string, number | null>;

export interface MealPlanFoodPortion {
  grams: number;
  nutrients: NutrientSnapshot;
}

export interface NutrientResult {
  value: number;
  complete: boolean;
  missing: number;
}

export type NutrientTotals = Record<string, NutrientResult>;

export function calculateNutrientTotals(items: MealPlanFoodPortion[]): NutrientTotals {
  const keys = new Set(items.flatMap((item) => Object.keys(item.nutrients)));
  return Object.fromEntries([...keys].sort().map((key) => [
    key,
    sumNutrient(items.map((item) => ({
      grams: item.grams,
      per100g: Object.hasOwn(item.nutrients, key) ? item.nutrients[key] : null,
    }))),
  ]));
}
