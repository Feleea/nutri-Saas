import { describe, it, expect } from 'vitest';
import { sumNutrient } from '../../src/nutrition/totals';

describe('US-PLA-02 · cálculo nutricional [unit]', () => {
  it('calcula por gramas a partir do valor por 100 g', () => {
    expect(sumNutrient([{ grams: 150, per100g: 52 }]).value).toBe(78);
  });

  it('soma de vários alimentos confere com a soma individual', () => {
    const r = sumNutrient([
      { grams: 100, per100g: 52 },
      { grams: 30, per100g: 364 },
      { grams: 200, per100g: 0.1 },
    ]);
    expect(r.value).toBeCloseTo(52 + 109.2 + 0.2, 3);
    expect(r.complete).toBe(true);
  });

  it('nutriente não informado não soma zero silenciosamente', () => {
    const r = sumNutrient([
      { grams: 100, per100g: 52 },
      { grams: 50, per100g: null },
    ]);
    expect(r.value).toBe(52);
    expect(r.complete).toBe(false);
    expect(r.missing).toBe(1);
  });

  it('zero informado é diferente de não informado', () => {
    expect(sumNutrient([{ grams: 100, per100g: 0 }]).complete).toBe(true);
  });
});
