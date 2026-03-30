ALTER TABLE "OutboxEvent" RENAME COLUMN "createdAt" TO "created_at";

ALTER TABLE "OutboxEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "OutboxEvent" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "OutboxEvent_status_created_at_idx" ON "OutboxEvent" ("status", "created_at");
