-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PAYOUT_DEBIT';

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "pspReferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payouts_connectedAccountId_createdAt_idx" ON "payouts"("connectedAccountId", "createdAt" DESC);

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "connected_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
