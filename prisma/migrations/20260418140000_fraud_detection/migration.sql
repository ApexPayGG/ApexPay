-- CreateEnum
CREATE TYPE "FraudCheckStatus" AS ENUM ('PASSED', 'FLAGGED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "FraudRuleTriggered" AS ENUM (
  'VELOCITY_CHARGE',
  'VELOCITY_PAYOUT',
  'UNUSUAL_AMOUNT',
  'DUPLICATE_CHARGE',
  'CARD_TESTING',
  'ACCOUNT_AGE_TOO_LOW',
  'REFUND_RATE_TOO_HIGH',
  'PAYOUT_SPIKE'
);

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'FRAUD_FLAGGED';
ALTER TYPE "AuditAction" ADD VALUE 'FRAUD_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'FRAUD_REVIEWED';

-- CreateTable
CREATE TABLE "fraud_checks" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "FraudCheckStatus" NOT NULL,
    "rulesTriggered" JSONB NOT NULL,
    "metadata" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fraud_checks_userId_createdAt_idx" ON "fraud_checks"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "fraud_checks_status_createdAt_idx" ON "fraud_checks"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "fraud_checks_entityType_entityId_idx" ON "fraud_checks"("entityType", "entityId");

-- AlterTable
ALTER TABLE "marketplace_charges" ADD COLUMN "fraudCheckId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_charges_fraudCheckId_key" ON "marketplace_charges"("fraudCheckId");

-- AddForeignKey
ALTER TABLE "marketplace_charges" ADD CONSTRAINT "marketplace_charges_fraudCheckId_fkey" FOREIGN KEY ("fraudCheckId") REFERENCES "fraud_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN "fraudCheckId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payouts_fraudCheckId_key" ON "payouts"("fraudCheckId");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_fraudCheckId_fkey" FOREIGN KEY ("fraudCheckId") REFERENCES "fraud_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
