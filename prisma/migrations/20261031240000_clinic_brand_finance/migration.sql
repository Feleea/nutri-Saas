ALTER TABLE "Account" ADD COLUMN "logoUrl" TEXT;

CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID');
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'OTHER');

CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "description" VARCHAR(160) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Charge_amountCents_check" CHECK ("amountCents" > 0),
    CONSTRAINT "Charge_paidAt_status_check" CHECK (
      ("status" = 'PENDING' AND "paidAt" IS NULL) OR
      ("status" = 'PAID' AND "paidAt" IS NOT NULL)
    )
);

CREATE INDEX "Charge_accountId_occurredAt_idx" ON "Charge"("accountId", "occurredAt");
CREATE INDEX "Charge_accountId_paidAt_idx" ON "Charge"("accountId", "paidAt");
CREATE INDEX "Charge_patientId_idx" ON "Charge"("patientId");
CREATE INDEX "Charge_appointmentId_idx" ON "Charge"("appointmentId");

ALTER TABLE "Charge" ADD CONSTRAINT "Charge_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
