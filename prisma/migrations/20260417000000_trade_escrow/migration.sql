-- Trade P2P escrow
CREATE TYPE "TradeStatus" AS ENUM (
  'PENDING_PAYMENT',
  'PAID_AWAITING_ITEM',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED'
);

CREATE TABLE "trades" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "buyerId" TEXT,
  "itemName" TEXT NOT NULL,
  "description" TEXT,
  "amountCents" BIGINT NOT NULL,
  "platformFeeCents" BIGINT NOT NULL DEFAULT 0,
  "status" "TradeStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "escrowReferenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trades_sellerId_idx" ON "trades"("sellerId");
CREATE INDEX "trades_buyerId_idx" ON "trades"("buyerId");
CREATE INDEX "trades_status_idx" ON "trades"("status");

ALTER TABLE "trades" ADD CONSTRAINT "trades_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "trades" ADD CONSTRAINT "trades_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRADE_ESCROW_HOLD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRADE_SELLER_CREDIT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRADE_PLATFORM_FEE';
