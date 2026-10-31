CREATE FUNCTION guard_meal_plan_plaintext_insert() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'suasnutri_app' THEN
    IF TG_TABLE_NAME = 'MealPlan' THEN
      IF NEW."title" IS NOT NULL THEN
        RAISE EXCEPTION 'títulos de plano devem ser cifrados';
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'MealPlanVersion' THEN
      IF NEW."encryptedPayload" IS NULL OR NEW."title" IS NOT NULL THEN
        RAISE EXCEPTION 'payload de versão deve ser cifrado';
      END IF;
    END IF;
    IF TG_TABLE_NAME IN ('MealPlanMeal', 'MealPlanItem') THEN
      RAISE EXCEPTION 'linhas plaintext de plano estão desabilitadas';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER meal_plan_plaintext_guard
  BEFORE INSERT ON "MealPlan"
  FOR EACH ROW EXECUTE FUNCTION guard_meal_plan_plaintext_insert();
CREATE TRIGGER meal_plan_version_plaintext_guard
  BEFORE INSERT ON "MealPlanVersion"
  FOR EACH ROW EXECUTE FUNCTION guard_meal_plan_plaintext_insert();
CREATE TRIGGER meal_plan_meal_plaintext_guard
  BEFORE INSERT ON "MealPlanMeal"
  FOR EACH ROW EXECUTE FUNCTION guard_meal_plan_plaintext_insert();
CREATE TRIGGER meal_plan_item_plaintext_guard
  BEFORE INSERT ON "MealPlanItem"
  FOR EACH ROW EXECUTE FUNCTION guard_meal_plan_plaintext_insert();
