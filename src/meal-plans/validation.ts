import { z } from 'zod';

const itemSchema = z.object({
  foodId: z.string().min(1).max(64),
  quantity: z.number().finite().positive().max(100000),
  measureId: z.string().min(1).max(64).nullable().optional(),
}).strict();

const mealSchema = z.object({
  name: z.string().trim().min(1).max(80),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  items: z.array(itemSchema).min(1).max(40),
}).strict();

export const mealPlanBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  meals: z.array(mealSchema).min(1).max(16),
}).strict();

export const mealPlanVersionBodySchema = mealPlanBodySchema.extend({
  baseVersion: z.number().int().positive(),
}).strict();

export type MealPlanBody = z.infer<typeof mealPlanBodySchema>;
export type MealPlanVersionBody = z.infer<typeof mealPlanVersionBodySchema>;
