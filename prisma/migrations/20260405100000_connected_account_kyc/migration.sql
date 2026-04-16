-- KYC F3: rozszerzenie connected_accounts + enum statusów + typ podmiotu

-- CreateEnum
CREATE TYPE "ConnectedAccountSubjectType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- AlterEnum: PENDING_VERIFICATION -> PENDING, + REJECTED
ALTER TYPE "ConnectedAccountStatus" RENAME VALUE 'PENDING_VERIFICATION' TO 'PENDING';
ALTER TYPE "ConnectedAccountStatus" ADD VALUE 'REJECTED';

-- Nowe kolumny (najpierw integrator + dane KYC)
ALTER TABLE "connected_accounts" ADD COLUMN "integratorUserId" TEXT;
UPDATE "connected_accounts" SET "integratorUserId" = "userId" WHERE "integratorUserId" IS NULL;
ALTER TABLE "connected_accounts" ALTER COLUMN "integratorUserId" SET NOT NULL;

ALTER TABLE "connected_accounts" ADD COLUMN "email" TEXT;
UPDATE "connected_accounts" AS ca SET "email" = u."email" FROM "User" AS u WHERE u."id" = ca."userId";
ALTER TABLE "connected_accounts" ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE "connected_accounts" ADD COLUMN "subjectType" "ConnectedAccountSubjectType" NOT NULL DEFAULT 'INDIVIDUAL';
ALTER TABLE "connected_accounts" ALTER COLUMN "subjectType" DROP DEFAULT;

ALTER TABLE "connected_accounts" ADD COLUMN "country" CHAR(2) NOT NULL DEFAULT 'PL';
ALTER TABLE "connected_accounts" ALTER COLUMN "country" DROP DEFAULT;

ALTER TABLE "connected_accounts" ADD COLUMN "kycReferenceId" TEXT;

-- userId opcjonalny (onboarding przed linkiem do User)
ALTER TABLE "connected_accounts" DROP CONSTRAINT IF EXISTS "connected_accounts_userId_fkey";
DROP INDEX IF EXISTS "connected_accounts_userId_key";
ALTER TABLE "connected_accounts" ALTER COLUMN "userId" DROP NOT NULL;

CREATE UNIQUE INDEX "connected_accounts_userId_key" ON "connected_accounts"("userId");

CREATE UNIQUE INDEX "connected_accounts_kycReferenceId_key" ON "connected_accounts"("kycReferenceId");

CREATE UNIQUE INDEX "connected_accounts_integratorUserId_email_key" ON "connected_accounts"("integratorUserId", "email");

CREATE INDEX "connected_accounts_integratorUserId_status_idx" ON "connected_accounts"("integratorUserId", "status");

ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_integratorUserId_fkey" FOREIGN KEY ("integratorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
