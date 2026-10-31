-- Preserve existing plaintext for the explicit, resumable backfill command.
CREATE TABLE "TenantDataEncryptionKey" (
  "accountId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantDataEncryptionKey_pkey" PRIMARY KEY ("accountId"),
  CONSTRAINT "TenantDataEncryptionKey_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "AnamnesisRecord" RENAME COLUMN "answers" TO "legacyAnswers";
ALTER TABLE "AnamnesisRecord" ALTER COLUMN "legacyAnswers" DROP NOT NULL;
ALTER TABLE "AnamnesisRecord" ADD COLUMN "answersCiphertext" TEXT;
ALTER TABLE "AnamnesisRecord"
  ADD CONSTRAINT "AnamnesisRecord_answers_present_check"
  CHECK ("answersCiphertext" IS NOT NULL OR "legacyAnswers" IS NOT NULL);

ALTER TABLE "AnthropometryRecord"
  ALTER COLUMN "measuredAt" DROP NOT NULL,
  ALTER COLUMN "weightKg" DROP NOT NULL,
  ALTER COLUMN "heightCm" DROP NOT NULL,
  ALTER COLUMN "bmi" DROP NOT NULL,
  ADD COLUMN "clinicalDataCiphertext" TEXT;
ALTER TABLE "AnthropometryRecord"
  ADD CONSTRAINT "AnthropometryRecord_clinical_data_present_check"
  CHECK (
    "clinicalDataCiphertext" IS NOT NULL OR (
      "measuredAt" IS NOT NULL AND "weightKg" IS NOT NULL AND "heightCm" IS NOT NULL AND "bmi" IS NOT NULL
    )
  );

-- The only permitted update to a measurement is the one-way encryption backfill.
CREATE OR REPLACE FUNCTION protect_anthropometry() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."clinicalDataCiphertext" IS NULL
     AND NEW."clinicalDataCiphertext" IS NOT NULL
     AND NEW."id" = OLD."id"
     AND NEW."accountId" = OLD."accountId"
     AND NEW."patientId" = OLD."patientId"
     AND NEW."createdByUserId" = OLD."createdByUserId"
     AND NEW."createdAt" = OLD."createdAt"
     AND NEW."measuredAt" IS NULL
     AND NEW."weightKg" IS NULL
     AND NEW."heightCm" IS NULL
     AND NEW."bmi" IS NULL
     AND NEW."waistCm" IS NULL
     AND NEW."hipCm" IS NULL
     AND NEW."neckCm" IS NULL
     AND NEW."armCm" IS NULL
     AND NEW."thighCm" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'registro clínico imutável';
END $$;

DROP TRIGGER IF EXISTS anthropometry_immutable ON "AnthropometryRecord";
CREATE TRIGGER anthropometry_immutable
  BEFORE UPDATE ON "AnthropometryRecord"
  FOR EACH ROW EXECUTE FUNCTION protect_anthropometry();
