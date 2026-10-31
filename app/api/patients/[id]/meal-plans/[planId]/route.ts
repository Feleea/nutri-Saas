import { defineRoute, failFrom, reply } from '@/src/server/http';
import { ctx } from '@/src/server/context';
import { mealPlanVersionBodySchema, type MealPlanVersionBody } from '@/src/meal-plans/validation';

type P = { id: string; planId: string };

export const GET = defineRoute<undefined, P>({
  auth: 'session',
  action: 'patient.read',
  handler: async ({ session, params }) => {
    const result = await ctx().mealPlans.get(session!, params.id, params.planId);
    if (!result.ok) return failFrom(result.reason);
    return { plan: result.plan };
  },
});

export const PUT = defineRoute<MealPlanVersionBody, P>({
  auth: 'session',
  action: 'patient.write',
  body: mealPlanVersionBodySchema,
  handler: async ({ session, params, body }) => {
    const result = await ctx().mealPlans.createVersion(session!, params.id, params.planId, body);
    return result.ok
      ? { version: result.version }
      : failFrom(result.reason, { errors: 'errors' in result ? result.errors : undefined });
  },
});
