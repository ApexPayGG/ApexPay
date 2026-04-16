-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM (
  'RECEIVED',
  'UNDER_REVIEW',
  'EVIDENCE_SUBMITTED',
  'WON',
  'LOST',
  'ACCEPTED'
);

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM (
  'FRAUDULENT',
  'DUPLICATE',
  'PRODUCT_NOT_RECEIVED',
  'PRODUCT_UNACCEPTABLE',
  'UNRECOGNIZED',
  'CREDIT_NOT_PROCESSED',
  'GENERAL'
);

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DISPUTE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DISPUTE_EVIDENCE_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'DISPUTE_RESOLVED';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'DISPUTE_HOLD';
ALTER TYPE "TransactionType" ADD VALUE 'DISPUTE_HOLD_RELEASE';
ALTER TYPE "TransactionType" ADD VALUE 'DISPUTE_DEBIT_FINAL';

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "pspDisputeId" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'RECEIVED',
    "reason" "DisputeReason" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "evidenceDueBy" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "integratorNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disputes_pspDisputeId_key" ON "disputes"("pspDisputeId");

-- CreateIndex
CREATE INDEX "disputes_chargeId_idx" ON "disputes"("chargeId");

-- CreateIndex
CREATE INDEX "disputes_status_evidenceDueBy_idx" ON "disputes"("status", "evidenceDueBy");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "marketplace_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
