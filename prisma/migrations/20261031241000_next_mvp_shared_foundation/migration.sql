CREATE TYPE "PatientConsultationPackageStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELED');

CREATE TABLE "PatientConsultationPackage" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "totalSessions" INTEGER NOT NULL,
  "remainingSessions" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "PatientConsultationPackageStatus" NOT NULL DEFAULT 'ACTIVE',
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientConsultationPackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientConsultationPackage_totalSessions_check" CHECK ("totalSessions" > 0),
  CONSTRAINT "PatientConsultationPackage_remainingSessions_check"
    CHECK ("remainingSessions" >= 0 AND "remainingSessions" <= "totalSessions"),
  CONSTRAINT "PatientConsultationPackage_amountCents_check" CHECK ("amountCents" >= 0),
  CONSTRAINT "PatientConsultationPackage_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatientConsultationPackage_patientId_accountId_fkey"
    FOREIGN KEY ("patientId", "accountId") REFERENCES "Patient"("id", "accountId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PatientConsultationPackage_id_accountId_key"
  ON "PatientConsultationPackage"("id", "accountId");
CREATE INDEX "PatientConsultationPackage_accountId_patientId_status_idx"
  ON "PatientConsultationPackage"("accountId", "patientId", "status");
CREATE INDEX "PatientConsultationPackage_accountId_purchasedAt_idx"
  ON "PatientConsultationPackage"("accountId", "purchasedAt");

CREATE UNIQUE INDEX "Appointment_id_accountId_key" ON "Appointment"("id", "accountId");

CREATE TABLE "PackageSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackageSession_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PackageSession_packageId_accountId_fkey"
    FOREIGN KEY ("packageId", "accountId")
    REFERENCES "PatientConsultationPackage"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PackageSession_appointmentId_accountId_fkey"
    FOREIGN KEY ("appointmentId", "accountId") REFERENCES "Appointment"("id", "accountId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PackageSession_appointmentId_key" ON "PackageSession"("appointmentId");
CREATE INDEX "PackageSession_accountId_packageId_usedAt_idx"
  ON "PackageSession"("accountId", "packageId", "usedAt");

CREATE TABLE "AppointmentAvailabilityRule" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "professionalUserId" TEXT,
  "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentAvailabilityRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentAvailabilityRule_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "AppointmentAvailabilityRule_minutes_check"
    CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440),
  CONSTRAINT "AppointmentAvailabilityRule_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppointmentAvailabilityRule_professionalUserId_fkey"
    FOREIGN KEY ("professionalUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AppointmentAvailabilityRule_accountId_weekday_active_idx"
  ON "AppointmentAvailabilityRule"("accountId", "weekday", "active");
CREATE INDEX "AppointmentAvailabilityRule_accountId_professionalUserId_weekday_active_idx"
  ON "AppointmentAvailabilityRule"("accountId", "professionalUserId", "weekday", "active");

CREATE TABLE "AppointmentBlock" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "professionalUserId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppointmentBlock_time_range_check" CHECK ("startsAt" < "endsAt"),
  CONSTRAINT "AppointmentBlock_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppointmentBlock_professionalUserId_fkey"
    FOREIGN KEY ("professionalUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppointmentBlock_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AppointmentBlock_accountId_startsAt_endsAt_idx"
  ON "AppointmentBlock"("accountId", "startsAt", "endsAt");
CREATE INDEX "AppointmentBlock_accountId_professionalUserId_startsAt_idx"
  ON "AppointmentBlock"("accountId", "professionalUserId", "startsAt");

CREATE TABLE "PatientAttachment" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientAttachment_sizeBytes_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "PatientAttachment_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatientAttachment_patientId_accountId_fkey"
    FOREIGN KEY ("patientId", "accountId") REFERENCES "Patient"("id", "accountId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatientAttachment_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PatientAttachment_accountId_patientId_createdAt_idx"
  ON "PatientAttachment"("accountId", "patientId", "createdAt");

CREATE TABLE "PatientPortalSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientPortalSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientPortalSession_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatientPortalSession_patientId_accountId_fkey"
    FOREIGN KEY ("patientId", "accountId") REFERENCES "Patient"("id", "accountId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PatientPortalSession_tokenHash_key" ON "PatientPortalSession"("tokenHash");
CREATE INDEX "PatientPortalSession_accountId_patientId_expiresAt_idx"
  ON "PatientPortalSession"("accountId", "patientId", "expiresAt");
CREATE INDEX "PatientPortalSession_accountId_expiresAt_idx"
  ON "PatientPortalSession"("accountId", "expiresAt");

CREATE FUNCTION ensure_package_session_patient_match() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  package_patient_id text;
  appointment_patient_id text;
BEGIN
  SELECT "patientId" INTO package_patient_id
    FROM "PatientConsultationPackage"
    WHERE "id" = NEW."packageId" AND "accountId" = NEW."accountId";
  SELECT "patientId" INTO appointment_patient_id
    FROM "Appointment"
    WHERE "id" = NEW."appointmentId" AND "accountId" = NEW."accountId";
  IF package_patient_id IS NULL OR appointment_patient_id IS NULL
     OR package_patient_id <> appointment_patient_id THEN
    RAISE EXCEPTION 'package session must reference the package patient appointment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_session_patient_match
  BEFORE INSERT OR UPDATE OF "accountId", "packageId", "appointmentId" ON "PackageSession"
  FOR EACH ROW EXECUTE FUNCTION ensure_package_session_patient_match();

CREATE FUNCTION guard_package_patient_reassignment() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."accountId" IS DISTINCT FROM OLD."accountId"
      OR NEW."patientId" IS DISTINCT FROM OLD."patientId")
     AND EXISTS (
       SELECT 1
       FROM "PackageSession" ps
       JOIN "Appointment" a
         ON a."id" = ps."appointmentId" AND a."accountId" = ps."accountId"
       WHERE ps."packageId" = OLD."id" AND ps."accountId" = OLD."accountId"
         AND (a."accountId" IS DISTINCT FROM NEW."accountId"
              OR a."patientId" IS DISTINCT FROM NEW."patientId")
     ) THEN
    RAISE EXCEPTION 'a package with used sessions cannot change tenant or patient';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_patient_reassignment_guard
  BEFORE UPDATE OF "accountId", "patientId" ON "PatientConsultationPackage"
  FOR EACH ROW EXECUTE FUNCTION guard_package_patient_reassignment();

CREATE FUNCTION guard_appointment_patient_reassignment() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."accountId" IS DISTINCT FROM OLD."accountId"
      OR NEW."patientId" IS DISTINCT FROM OLD."patientId")
     AND EXISTS (
       SELECT 1
       FROM "PackageSession" ps
       JOIN "PatientConsultationPackage" p
         ON p."id" = ps."packageId" AND p."accountId" = ps."accountId"
       WHERE ps."appointmentId" = OLD."id" AND ps."accountId" = OLD."accountId"
         AND (p."accountId" IS DISTINCT FROM NEW."accountId"
              OR p."patientId" IS DISTINCT FROM NEW."patientId")
     ) THEN
    RAISE EXCEPTION 'an appointment linked to a package session cannot change tenant or patient';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_patient_reassignment_guard
  BEFORE UPDATE OF "accountId", "patientId" ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_patient_reassignment();

CREATE FUNCTION ensure_appointment_staff_membership() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."professionalUserId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "accountId" = NEW."accountId" AND "userId" = NEW."professionalUserId"
  ) THEN
    RAISE EXCEPTION 'professional must belong to appointment tenant';
  END IF;
  IF TG_TABLE_NAME = 'AppointmentBlock' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Membership"
      WHERE "accountId" = NEW."accountId" AND "userId" = NEW."createdByUserId"
    ) THEN
      RAISE EXCEPTION 'block creator must belong to appointment tenant';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER availability_rule_professional_membership
  BEFORE INSERT OR UPDATE OF "accountId", "professionalUserId" ON "AppointmentAvailabilityRule"
  FOR EACH ROW EXECUTE FUNCTION ensure_appointment_staff_membership();
CREATE TRIGGER appointment_block_staff_membership
  BEFORE INSERT OR UPDATE OF "accountId", "professionalUserId", "createdByUserId" ON "AppointmentBlock"
  FOR EACH ROW EXECUTE FUNCTION ensure_appointment_staff_membership();

CREATE FUNCTION ensure_attachment_creator_membership() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "accountId" = NEW."accountId" AND "userId" = NEW."createdByUserId"
  ) THEN
    RAISE EXCEPTION 'attachment creator must belong to patient tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patient_attachment_creator_membership
  BEFORE INSERT OR UPDATE OF "accountId", "createdByUserId" ON "PatientAttachment"
  FOR EACH ROW EXECUTE FUNCTION ensure_attachment_creator_membership();
