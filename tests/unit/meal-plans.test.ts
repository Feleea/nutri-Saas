import { describe, expect, it } from 'vitest';
import { calculateNutrientTotals, compareSubstitution } from '../../src/meal-plans/nutrition';
import { mealPlanBodySchema, mealPlanVersionBodySchema } from '../../src/meal-plans/validation';

describe('US-PLA-02 · cálculo de nutrientes [unit]', () => {
  it('converte gramas sem arredondamento acumulado e mantém nutrientes ausentes como desconhecidos', () => {
    const totals = calculateNutrientTotals([
      { grams: 50, nutrients: { energyKcal: 100, proteinG: 4, calciumMg: 20, vitaminCMg: null } },
      { grams: 100, nutrients: { energyKcal: 80, proteinG: null, calciumMg: 10 } },
    ]);
    expect(totals).toEqual({
      calciumMg: { value: 20, complete: true, missing: 0 },
      energyKcal: { value: 130, complete: true, missing: 0 },
      proteinG: { value: 2, complete: false, missing: 1 },
      vitaminCMg: { value: 0, complete: false, missing: 2 },
    });
  });

  it('permite zeros informados e diferencia zero de não informado', () => {
    const totals = calculateNutrientTotals([
      { grams: 100, nutrients: { vitaminCMg: 0 } },
      { grams: 100, nutrients: { vitaminCMg: null } },
    ]);
    expect(totals.vitaminCMg).toEqual({ value: 0, complete: false, missing: 1 });
  });
});

describe('US-PLA-01 · validação do plano [unit]', () => {
  const body = {
    title: 'Plano teste',
    meals: [{ name: 'Café da manhã', time: '08:00', items: [{ foodId: 'food-1', quantity: 2, measureId: 'measure-1' }] }],
  };

  it('valida planos por refeição e versões com controle de concorrência', () => {
    expect(mealPlanBodySchema.parse(body)).toEqual(body);
    expect(mealPlanVersionBodySchema.parse({ ...body, baseVersion: 3 }).baseVersion).toBe(3);
    expect(mealPlanVersionBodySchema.safeParse({ ...body, baseVersion: 0 }).success).toBe(false);
  });

  describe('US-PLA-05 · comparação de substituições [unit]', () => {
    it('calcula diferenças de energia e macros e sinaliza quando supera a tolerância', () => {
      expect(compareSubstitution(
        { grams: 100, nutrients: { energyKcal: 100, proteinG: 10, carbG: 20, fatG: 2 } },
        { grams: 100, nutrients: { energyKcal: 120, proteinG: 9, carbG: 22, fatG: 2 } },
      )).toMatchObject({
        exceedsTolerance: true,
        nutrients: {
          energyKcal: { primary: 100, alternative: 120, delta: 20, deltaPercent: 20 },
          proteinG: { deltaPercent: -10 },
        },
      });
    });

    it('sinaliza valores não comparáveis sem ocultar nutrientes ausentes', () => {
      expect(compareSubstitution(
        { grams: 100, nutrients: { energyKcal: null } },
        { grams: 100, nutrients: { energyKcal: 100 } },
      )).toMatchObject({ exceedsTolerance: false, nutrients: { energyKcal: { primary: null, alternative: 100, delta: null } } });
    });
  });

  it('rejeita horário inválido, quantidade não positiva e payload com campos desconhecidos', () => {
    expect(mealPlanBodySchema.safeParse({ ...body, meals: [{ ...body.meals[0], time: '25:61' }] }).success).toBe(false);
    expect(mealPlanBodySchema.safeParse({ ...body, meals: [{ ...body.meals[0], items: [{ foodId: 'food-1', quantity: 0 }] }] }).success).toBe(false);
    expect(mealPlanBodySchema.safeParse({ ...body, clinicalNotes: 'não deve ser aceito' }).success).toBe(false);
  });
});
