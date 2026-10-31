CREATE TABLE "MealPlan" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MealPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MealPlan_patientId_accountId_fkey" FOREIGN KEY ("patientId", "accountId") REFERENCES "Patient"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MealPlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MealPlan_id_accountId_key" ON "MealPlan"("id", "accountId");
CREATE INDEX "MealPlan_accountId_patientId_createdAt_idx" ON "MealPlan"("accountId", "patientId", "createdAt");

CREATE TABLE "MealPlanVersion" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealPlanVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MealPlanVersion_planId_accountId_fkey" FOREIGN KEY ("planId", "accountId") REFERENCES "MealPlan"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MealPlanVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MealPlanVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MealPlanVersion_planId_version_key" ON "MealPlanVersion"("planId", "version");
CREATE UNIQUE INDEX "MealPlanVersion_id_accountId_key" ON "MealPlanVersion"("id", "accountId");
CREATE INDEX "MealPlanVersion_accountId_planId_idx" ON "MealPlanVersion"("accountId", "planId");

CREATE TABLE "MealPlanMeal" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "time" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "MealPlanMeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MealPlanMeal_versionId_accountId_fkey" FOREIGN KEY ("versionId", "accountId") REFERENCES "MealPlanVersion"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MealPlanMeal_id_accountId_key" ON "MealPlanMeal"("id", "accountId");
CREATE INDEX "MealPlanMeal_accountId_versionId_sortOrder_idx" ON "MealPlanMeal"("accountId", "versionId", "sortOrder");

CREATE TABLE "MealPlanItem" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "mealId" TEXT NOT NULL,
  "foodId" TEXT NOT NULL,
  "measureId" TEXT,
  "quantity" DECIMAL(10,3) NOT NULL,
  "grams" DECIMAL(10,3) NOT NULL,
  "measureLabel" TEXT NOT NULL,
  "measureGrams" DECIMAL(10,3) NOT NULL,
  "foodName" TEXT NOT NULL,
  "sourceCode" TEXT,
  "sourceName" TEXT,
  "sourceVersion" TEXT,
  "nutrients" JSONB NOT NULL,
  CONSTRAINT "MealPlanItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MealPlanItem_mealId_accountId_fkey" FOREIGN KEY ("mealId", "accountId") REFERENCES "MealPlanMeal"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MealPlanItem_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MealPlanItem_measureId_fkey" FOREIGN KEY ("measureId") REFERENCES "HouseholdMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MealPlanItem_accountId_mealId_idx" ON "MealPlanItem"("accountId", "mealId");
CREATE INDEX "MealPlanItem_foodId_idx" ON "MealPlanItem"("foodId");

GRANT SELECT, INSERT ON "MealPlan", "MealPlanVersion", "MealPlanMeal", "MealPlanItem" TO suasnutri_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MealPlan', 'MealPlanVersion', 'MealPlanMeal', 'MealPlanItem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO suasnutri_app USING ("accountId" = app_account_id()) WITH CHECK ("accountId" = app_account_id())',
      t
    );
  END LOOP;
END $$;

CREATE FUNCTION validate_meal_plan_item_tenant() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  food_account_id TEXT;
  measure_food_id TEXT;
BEGIN
  SELECT "accountId" INTO food_account_id FROM "Food" WHERE "id" = NEW."foodId";
  IF food_account_id IS NOT NULL AND food_account_id <> NEW."accountId" THEN
    RAISE EXCEPTION 'alimento de outro tenant';
  END IF;
  IF NEW."measureId" IS NOT NULL THEN
    SELECT "foodId" INTO measure_food_id FROM "HouseholdMeasure" WHERE "id" = NEW."measureId";
    IF measure_food_id IS DISTINCT FROM NEW."foodId" THEN
      RAISE EXCEPTION 'medida não pertence ao alimento';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meal_plan_item_tenant_guard
  BEFORE INSERT OR UPDATE ON "MealPlanItem"
  FOR EACH ROW EXECUTE FUNCTION validate_meal_plan_item_tenant();

CREATE FUNCTION forbid_meal_plan_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'versão de plano alimentar imutável'; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MealPlan', 'MealPlanVersion', 'MealPlanMeal', 'MealPlanItem'] LOOP
    EXECUTE format('CREATE TRIGGER meal_plan_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_meal_plan_mutation()', t);
  END LOOP;
END $$;
