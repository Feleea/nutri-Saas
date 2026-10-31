import { z } from 'zod';
import { defineRoute, reply, fail, failFrom, cookie, SESSION_COOKIE, ADMIN_COOKIE } from '@/src/server/http';
import { ctx } from '@/src/server/context';

const nutrient = z.number().min(0).max(100000).nullable().optional();

export const POST = defineRoute({
  auth: 'session',
  action: 'foods.write',
  body: z.object({
    name: z.string().min(1).max(160),
    per: z.enum(['100g', 'portion']),
    portionGrams: z.number().positive().max(100000).optional(),
    values: z.object({ energyKcal: nutrient, proteinG: nutrient, carbG: nutrient, fatG: nutrient, fiberG: nutrient }),
    micros: z.record(z.string().max(40), z.number().min(0)).optional(),
    confirm: z.boolean().optional(),
  }),
  handler: async ({ session, body }) => {
    const r = await ctx().foods.createCustomFood(session!, body);
    if (r.ok) return reply({ id: r.food.id, name: r.food.name, warnings: r.warnings }, { status: 201 });
    return fail(422, 'validation', { errors: r.errors, warnings: r.warnings, needsConfirm: 'needsConfirm' in r });
  },
});
