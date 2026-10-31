import { PrismaClient } from '@prisma/client';
import { forTenant } from '../db/tenant';
import type { SessionInfo } from '../auth/service';
import { normalizeName } from './normalize';
import { expandTerm } from './synonyms';
import { validateFoodValues, toPer100g, type FoodValues } from './validate';
import { offeredMeasures, type Measure } from './measures';
import { calculateRecipeNutrition, type RecipeIngredientInput } from './recipes';

const n = (d: unknown) => (d === null || d === undefined ? null : Number(d));

export interface CustomFoodInput {
  name: string;
  per: '100g' | 'portion';
  portionGrams?: number;
  values: FoodValues;
  micros?: Record<string, number>;
  /** Confirma o salvamento apesar dos avisos de consistência. */
  confirm?: boolean;
}

export function createFoodService({ db }: { db: PrismaClient }) {
  const tenant = (s: SessionInfo) => forTenant(s.accountId, s.userId, db);

  /** Resultados da tabela padrão da conta primeiro; depois quem começa com o termo; depois nomes mais curtos. */
  async function search(s: SessionInfo, term: string, opts: { limit?: number } = {}) {
    const terms = expandTerm(term);
    if (!terms[0]) return [];
    const t = tenant(s);
    const account = await t.account.findUnique({ where: { id: s.accountId } });
    const preferred = account?.defaultFoodTableId ?? null;
    const found = await t.food.findMany({
      where: { OR: terms.map((x) => ({ normalizedName: { contains: x } })) },
      include: { table: { select: { code: true, name: true, version: true } } },
      take: 80,
    });
    const main = terms[0];
    const rank = (f: (typeof found)[number]) =>
      [f.tableId && f.tableId === preferred ? 0 : 1, f.normalizedName.startsWith(main) ? 0 : 1, f.normalizedName.length];
    return found
      .sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
      })
      .slice(0, opts.limit ?? 20)
      .map((f) => ({
        id: f.id,
        name: f.name,
        own: f.accountId !== null,
        // atribuição de fonte e versão exibida junto do alimento
        source: f.table ? { code: f.table.code, name: f.table.name, version: f.table.version } : null,
        energyKcal: n(f.energyKcal), proteinG: n(f.proteinG), carbG: n(f.carbG), fatG: n(f.fatG), fiberG: n(f.fiberG),
        micros: f.micros,
      }));
  }

  async function setDefaultTable(s: SessionInfo, tableCode: string) {
    if (s.role !== 'TITULAR') return { ok: false as const, reason: 'forbidden' as const };
    const table = await db.foodTable.findUnique({ where: { code: tableCode } });
    if (!table) return { ok: false as const, reason: 'not_found' as const };
    await tenant(s).account.update({ where: { id: s.accountId }, data: { defaultFoodTableId: table.id } });
    return { ok: true as const };
  }

  async function createCustomFood(s: SessionInfo, input: CustomFoodInput) {
    if (!input.name?.trim()) return { ok: false as const, errors: ['name_required'], warnings: [] as string[] };
    let values = input.values;
    if (input.per === 'portion') {
      if (!(input.portionGrams && input.portionGrams > 0)) return { ok: false as const, errors: ['portion_invalid'], warnings: [] as string[] };
      const g = input.portionGrams;
      const conv = (x?: number | null) => (typeof x === 'number' ? toPer100g(x, g) : null);
      values = { energyKcal: conv(values.energyKcal), proteinG: conv(values.proteinG), carbG: conv(values.carbG), fatG: conv(values.fatG), fiberG: conv(values.fiberG) };
    }
    const v = validateFoodValues(values);
    if (v.errors.length) return { ok: false as const, errors: v.errors, warnings: v.warnings };
    if (v.warnings.length && !input.confirm) {
      return { ok: false as const, errors: [] as string[], warnings: v.warnings, needsConfirm: true as const };
    }
    const food = await tenant(s).food.create({
      data: {
        accountId: s.accountId, name: input.name.trim(), normalizedName: normalizeName(input.name),
        energyKcal: values.energyKcal ?? null, proteinG: values.proteinG ?? null, carbG: values.carbG ?? null,
        fatG: values.fatG ?? null, fiberG: values.fiberG ?? null, micros: input.micros,
      },
    });
    return { ok: true as const, food, warnings: v.warnings };
  }

  async function createRecipe(
    s: SessionInfo,
    input: { name: string; yieldGrams: number; ingredients: { foodId: string; grams: number }[]; confirm?: boolean },
  ) {
    if (!['TITULAR', 'PROFISSIONAL'].includes(s.role)) return { ok: false as const, reason: 'forbidden' as const };
    const foodIds = [...new Set(input.ingredients.map((ingredient) => ingredient.foodId))];
    const t = tenant(s);
    const foods = await t.food.findMany({
      where: { id: { in: foodIds } },
      include: { table: { select: { code: true, name: true, version: true } } },
    });
    const foodsById = new Map(foods.map((food) => [food.id, food]));
    if (foodsById.size !== foodIds.length) return { ok: false as const, reason: 'ingredient_unavailable' as const };
    const ingredients: RecipeIngredientInput[] = input.ingredients.map((ingredient) => {
      const food = foodsById.get(ingredient.foodId)!;
      return {
        foodId: food.id,
        grams: ingredient.grams,
        name: food.name,
        nutrients: {
          energyKcal: n(food.energyKcal),
          proteinG: n(food.proteinG),
          carbG: n(food.carbG),
          fatG: n(food.fatG),
          fiberG: n(food.fiberG),
          ...(food.micros && typeof food.micros === 'object' && !Array.isArray(food.micros) ? food.micros : {}),
        },
      };
    });
    let nutrition;
    try {
      nutrition = calculateRecipeNutrition(ingredients, input.yieldGrams);
    } catch (error) {
      if (error instanceof Error && ['recipe_input_invalid', 'ingredient_quantity_invalid'].includes(error.message)) {
        return { ok: false as const, reason: 'validation' as const, errors: [error.message] };
      }
      throw error;
    }
    const validation = validateFoodValues(nutrition.values);
    const create = async () => t.$transaction(async (tx) => {
      const food = await tx.food.create({
        data: {
          accountId: s.accountId,
          name: input.name.trim(),
          normalizedName: normalizeName(input.name),
          energyKcal: nutrition.values.energyKcal,
          proteinG: nutrition.values.proteinG,
          carbG: nutrition.values.carbG,
          fatG: nutrition.values.fatG,
          fiberG: nutrition.values.fiberG,
          micros: nutrition.micros,
        },
      });
      await tx.recipeIngredient.createMany({
        data: ingredients.map((ingredient) => ({
          accountId: s.accountId,
          recipeFoodId: food.id,
          ingredientFoodId: ingredient.foodId,
          grams: ingredient.grams,
          ingredientName: ingredient.name,
          nutrients: ingredient.nutrients,
        })),
      });
      return food;
    });
    if (validation.warnings.length && !input.confirm) {
      return { ok: false as const, reason: 'confirm_warnings' as const, warnings: validation.warnings };
    }
    const food = await create();
    return { ok: true as const, food, ingredients, yieldGrams: input.yieldGrams, warnings: validation.warnings };
  }

  /** Só alimentos do próprio tenant aceitam novas medidas; os das tabelas oficiais são somente leitura. */
  async function addMeasure(s: SessionInfo, foodId: string, label: string, grams: number) {
    if (!label.trim() || !(grams > 0)) return { ok: false as const, reason: 'invalid' as const };
    const t = tenant(s);
    const own = await t.food.findFirst({ where: { id: foodId, accountId: s.accountId } });
    if (!own) return { ok: false as const, reason: 'not_found' as const };
    await t.householdMeasure.create({ data: { foodId, label: label.trim(), grams } });
    return { ok: true as const };
  }

  async function getMeasures(s: SessionInfo, foodId: string): Promise<Measure[]> {
    const rows = await tenant(s).householdMeasure.findMany({ where: { foodId }, orderBy: { label: 'asc' } });
    return offeredMeasures(rows.map((r) => ({ label: r.label, grams: Number(r.grams) })));
  }

  async function getMeasureOptions(s: SessionInfo, foodId: string) {
    const rows = await tenant(s).householdMeasure.findMany({
      where: { foodId }, orderBy: { label: 'asc' }, select: { id: true, label: true, grams: true },
    });
    return [{ id: null, label: 'g', grams: 1 }, ...rows.map((row) => ({ ...row, grams: Number(row.grams) }))];
  }

  return { search, setDefaultTable, createCustomFood, createRecipe, addMeasure, getMeasures, getMeasureOptions };
}
