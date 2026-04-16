-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REFUND_DEBIT';
ALTER TYPE "TransactionType" ADD VALUE 'REFUND_CREDIT';

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundCoveredBy" AS ENUM ('PLATFORM', 'CONNECTED_ACCOUNT', 'SPLIT');

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "coveredBy" "RefundCoveredBy" NOT NULL,
    "reason" TEXT,
    "initiatedBy" TEXT NOT NULL,
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");

-- CreateIndex
CREATE INDEX "refunds_chargeId_createdAt_idx" ON "refunds"("chargeId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "marketplace_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
