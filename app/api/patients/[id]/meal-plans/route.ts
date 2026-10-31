import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { mealPlanBodySchema, type MealPlanBody } from '@/src/meal-plans/validation';

type P = { id: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const result = await ctx().mealPlans.list(session!, params.id);
    if (!result.ok) return failFrom(result.reason);
    return { items: result.items };
  },
});

export const POST = defineRoute<MealPlanBody, P>({
  auth: 'session',
  action: 'patient.write',
  body: mealPlanBodySchema,
  handler: async ({ session, params, body }) => {
    const result = await ctx().mealPlans.create(session!, params.id, body);
    return result.ok
      ? reply({ plan: result.plan, version: result.version }, { status: 201 })
      : failFrom(result.reason, { errors: 'errors' in result ? result.errors : undefined });
  },
});
