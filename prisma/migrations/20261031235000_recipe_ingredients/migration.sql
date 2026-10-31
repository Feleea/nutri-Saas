CREATE UNIQUE INDEX "Food_id_accountId_key" ON "Food"("id", "accountId");

CREATE TABLE "RecipeIngredient" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "recipeFoodId" TEXT NOT NULL,
  "ingredientFoodId" TEXT NOT NULL,
  "grams" DECIMAL(10,3) NOT NULL,
  "ingredientName" TEXT NOT NULL,
  "nutrients" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecipeIngredient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeIngredient_recipeFoodId_accountId_fkey" FOREIGN KEY ("recipeFoodId", "accountId") REFERENCES "Food"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecipeIngredient_ingredientFoodId_fkey" FOREIGN KEY ("ingredientFoodId") REFERENCES "Food"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RecipeIngredient_accountId_recipeFoodId_idx" ON "RecipeIngredient"("accountId", "recipeFoodId");

GRANT SELECT, INSERT ON "RecipeIngredient" TO suasnutri_app;
ALTER TABLE "RecipeIngredient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecipeIngredient" TO suasnutri_app
  USING ("accountId" = app_account_id())
  WITH CHECK ("accountId" = app_account_id());

CREATE FUNCTION validate_recipe_ingredient_tenant() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  recipe_account_id TEXT;
  ingredient_account_id TEXT;
BEGIN
  SELECT "accountId" INTO recipe_account_id FROM "Food" WHERE "id" = NEW."recipeFoodId";
  IF recipe_account_id IS DISTINCT FROM NEW."accountId" THEN
    RAISE EXCEPTION 'receita deve pertencer ao tenant';
  END IF;
  SELECT "accountId" INTO ingredient_account_id FROM "Food" WHERE "id" = NEW."ingredientFoodId";
  IF ingredient_account_id IS NOT NULL AND ingredient_account_id <> NEW."accountId" THEN
    RAISE EXCEPTION 'ingrediente de outro tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recipe_ingredient_tenant_guard
  BEFORE INSERT OR UPDATE ON "RecipeIngredient"
  FOR EACH ROW EXECUTE FUNCTION validate_recipe_ingredient_tenant();

CREATE FUNCTION forbid_recipe_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'composição de receita imutável'; END $$;
CREATE TRIGGER recipe_ingredient_immutable
  BEFORE UPDATE OR DELETE ON "RecipeIngredient"
  FOR EACH ROW EXECUTE FUNCTION forbid_recipe_mutation();
