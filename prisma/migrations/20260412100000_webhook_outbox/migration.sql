-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "webhook_outboxes" (
    "id" TEXT NOT NULL,
    "integratorUserId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_outboxes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_outboxes_status_nextAttemptAt_idx" ON "webhook_outboxes"("status", "nextAttemptAt");

ALTER TABLE "webhook_outboxes" ADD CONSTRAINT "webhook_outboxes_integratorUserId_fkey" FOREIGN KEY ("integratorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
