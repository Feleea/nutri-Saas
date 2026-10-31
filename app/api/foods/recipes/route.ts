import { z } from 'zod';
import { defineRoute, fail, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  yieldGrams: z.number().finite().positive().max(1_000_000),
  ingredients: z.array(z.object({
    foodId: z.string().min(1).max(64),
    grams: z.number().finite().positive().max(1_000_000),
  }).strict()).min(1).max(100),
  confirm: z.boolean().optional(),
}).strict();

export const POST = defineRoute({
  auth: 'session',
  action: 'foods.write',
  body: bodySchema,
  handler: async ({ session, body }) => {
    const result = await ctx().foods.createRecipe(session!, body);
    if (result.ok) {
      return reply({
        id: result.food.id,
        name: result.food.name,
        valuesPer100g: {
          energyKcal: result.food.energyKcal,
          proteinG: result.food.proteinG,
          carbG: result.food.carbG,
          fatG: result.food.fatG,
          fiberG: result.food.fiberG,
        },
        yieldGrams: result.yieldGrams,
        ingredients: result.ingredients.map(({ foodId, grams, name }) => ({ foodId, grams, name })),
        warnings: result.warnings,
      }, { status: 201 });
    }
    if ('warnings' in result) return fail(422, result.reason, { warnings: result.warnings, needsConfirm: true });
    return fail(422, result.reason, { errors: 'errors' in result ? result.errors : undefined });
  },
});
