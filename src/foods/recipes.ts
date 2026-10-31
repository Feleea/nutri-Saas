import { sumNutrient } from '../nutrition/totals';
import type { NutrientSnapshot } from '../meal-plans/nutrition';

export interface RecipeIngredientInput {
  foodId: string;
  grams: number;
  name: string;
  nutrients: NutrientSnapshot;
}

export interface RecipeNutrition {
  values: {
    energyKcal: number | null;
    proteinG: number | null;
    carbG: number | null;
    fatG: number | null;
    fiberG: number | null;
  };
  micros: Record<string, number>;
}

export function calculateRecipeNutrition(ingredients: RecipeIngredientInput[], yieldGrams: number): RecipeNutrition {
  if (!Number.isFinite(yieldGrams) || yieldGrams <= 0 || ingredients.length === 0) {
    throw new Error('recipe_input_invalid');
  }
  for (const ingredient of ingredients) {
    if (!Number.isFinite(ingredient.grams) || ingredient.grams <= 0 || ingredient.grams > 1_000_000) {
      throw new Error('ingredient_quantity_invalid');
    }
  }

  const keys = new Set(ingredients.flatMap((ingredient) => Object.keys(ingredient.nutrients)));
  const totals = Object.fromEntries([...keys].map((key) => [
    key,
    sumNutrient(ingredients.map((ingredient) => ({
      grams: ingredient.grams,
      per100g: Object.hasOwn(ingredient.nutrients, key) ? ingredient.nutrients[key] : null,
    }))),
  ]));
  const per100g = (key: string) => {
    const result = totals[key];
    return result?.complete ? Number(((result.value * 100) / yieldGrams).toFixed(3)) : null;
  };
  const values = {
    energyKcal: per100g('energyKcal'),
    proteinG: per100g('proteinG'),
    carbG: per100g('carbG'),
    fatG: per100g('fatG'),
    fiberG: per100g('fiberG'),
  };
  const micros = Object.fromEntries(
    [...keys].filter((key) => !['energyKcal', 'proteinG', 'carbG', 'fatG', 'fiberG'].includes(key))
      .flatMap((key) => {
        const value = per100g(key);
        return value === null ? [] : [[key, value]];
      }),
  );
  return { values, micros };
}
