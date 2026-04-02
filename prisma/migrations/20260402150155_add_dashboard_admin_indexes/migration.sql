-- AlterTable
ALTER TABLE "OutboxEvent" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Transaction_walletId_createdAt_idx" ON "Transaction"("walletId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_balances_userId_createdAt_idx" ON "user_balances"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "user_balances_matchId_createdAt_idx" ON "user_balances"("matchId", "createdAt" DESC);
