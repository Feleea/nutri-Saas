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

const COMPARISON_NUTRIENTS = ['energyKcal', 'proteinG', 'carbG', 'fatG'] as const;

export function compareSubstitution(
  primary: { grams: number; nutrients: NutrientSnapshot },
  alternative: { grams: number; nutrients: NutrientSnapshot },
  tolerancePercent = 10,
) {
  const nutrients = Object.fromEntries(COMPARISON_NUTRIENTS.map((key) => {
    const primaryValue = Object.hasOwn(primary.nutrients, key) && primary.nutrients[key] !== null
      ? primary.grams * primary.nutrients[key]! / 100 : null;
    const alternativeValue = Object.hasOwn(alternative.nutrients, key) && alternative.nutrients[key] !== null
      ? alternative.grams * alternative.nutrients[key]! / 100 : null;
    const comparable = primaryValue !== null && alternativeValue !== null;
    const delta = comparable ? Number((alternativeValue - primaryValue).toFixed(3)) : null;
    const deltaPercent = comparable
      ? primaryValue === 0 ? (alternativeValue === 0 ? 0 : null)
        : Number((((alternativeValue - primaryValue) / primaryValue) * 100).toFixed(1))
      : null;
    return [key, { primary: primaryValue, alternative: alternativeValue, delta, deltaPercent }];
  }));
  const exceedsTolerance = Object.values(nutrients).some((entry) =>
    entry.deltaPercent !== null && Math.abs(entry.deltaPercent) > tolerancePercent,
  );
  return { tolerancePercent, exceedsTolerance, nutrients };
}

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
