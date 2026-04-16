-- AlterTable
ALTER TABLE "marketplace_charges" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PLN';

ALTER TABLE "marketplace_charges" ADD COLUMN "integratorUserId" TEXT;

UPDATE "marketplace_charges" SET "integratorUserId" = "debitUserId" WHERE "integratorUserId" IS NULL;

ALTER TABLE "marketplace_charges" ALTER COLUMN "integratorUserId" SET NOT NULL;

CREATE INDEX "marketplace_charges_integratorUserId_createdAt_idx" ON "marketplace_charges"("integratorUserId", "createdAt" DESC);
