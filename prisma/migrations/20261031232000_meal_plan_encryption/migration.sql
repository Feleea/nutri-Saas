ALTER TABLE "MealPlan" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "MealPlanVersion" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "MealPlanVersion" ADD COLUMN "encryptedPayload" TEXT;

CREATE OR REPLACE FUNCTION forbid_meal_plan_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'MealPlanVersion'
    AND OLD."encryptedPayload" IS NULL
    AND NEW."encryptedPayload" IS NOT NULL
    AND NEW."title" IS NULL
    AND NEW."id" = OLD."id"
    AND NEW."planId" = OLD."planId"
    AND NEW."accountId" = OLD."accountId"
    AND NEW."version" = OLD."version"
    AND NEW."createdByUserId" = OLD."createdByUserId"
    AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'MealPlan'
    AND NEW."title" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'versão de plano alimentar imutável';
END $$;
