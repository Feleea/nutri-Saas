ALTER TABLE "MealPlanVersion" ADD COLUMN "title" TEXT;
ALTER TABLE "MealPlanVersion" DISABLE TRIGGER meal_plan_immutable;
UPDATE "MealPlanVersion" AS version
SET "title" = plan."title"
FROM "MealPlan" AS plan
WHERE plan."id" = version."planId";
ALTER TABLE "MealPlanVersion" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "MealPlanVersion" ENABLE TRIGGER meal_plan_immutable;
