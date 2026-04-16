-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'MARKETPLACE_PAYER_DEBIT';
ALTER TYPE "TransactionType" ADD VALUE 'MARKETPLACE_CONNECTED_CREDIT';

-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED');

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connected_accounts_userId_key" ON "connected_accounts"("userId");

ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "marketplace_charges" (
    "id" TEXT NOT NULL,
    "debitUserId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_charges_idempotencyKey_key" ON "marketplace_charges"("idempotencyKey");

CREATE INDEX "marketplace_charges_debitUserId_createdAt_idx" ON "marketplace_charges"("debitUserId", "createdAt" DESC);
