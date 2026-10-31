ALTER TABLE "RecipeIngredient"
  DROP CONSTRAINT "RecipeIngredient_ingredientFoodId_fkey";

CREATE INDEX "RecipeIngredient_ingredientFoodId_idx"
  ON "RecipeIngredient"("ingredientFoodId");

CREATE OR REPLACE FUNCTION validate_recipe_ingredient_tenant() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  recipe_account_id TEXT;
  ingredient_account_id TEXT;
BEGIN
  SELECT "accountId" INTO recipe_account_id
    FROM "Food" WHERE "id" = NEW."recipeFoodId";
  IF recipe_account_id IS DISTINCT FROM NEW."accountId" THEN
    RAISE EXCEPTION 'receita deve pertencer ao tenant';
  END IF;

  SELECT "accountId" INTO ingredient_account_id
    FROM "Food" WHERE "id" = NEW."ingredientFoodId" FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingrediente não encontrado';
  END IF;
  IF ingredient_account_id IS NOT NULL AND ingredient_account_id <> NEW."accountId" THEN
    RAISE EXCEPTION 'ingrediente de outro tenant';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_recipe_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'composição de receita imutável';
END $$;
