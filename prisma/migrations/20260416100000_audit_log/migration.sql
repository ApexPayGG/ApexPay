-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM (
  'CHARGE_CREATED',
  'CHARGE_REFUNDED',
  'PAYOUT_CREATED',
  'PAYOUT_SETTLED',
  'PAYOUT_FAILED',
  'WALLET_CREDITED',
  'WALLET_DEBITED',
  'API_KEY_CREATED',
  'API_KEY_DELETED',
  'CONNECTED_ACCOUNT_CREATED',
  'CONNECTED_ACCOUNT_STATUS_CHANGED',
  'WEBHOOK_CONFIG_UPDATED',
  'ADMIN_LOGIN'
);

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM (
  'USER',
  'ADMIN',
  'SYSTEM',
  'PSP'
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);
