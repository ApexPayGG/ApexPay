-- CreateTable
CREATE TABLE "webhook_dead_letters" (
    "id" TEXT NOT NULL,
    "integratorUserId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "originalOutboxId" TEXT,
    "requeued" BOOLEAN NOT NULL DEFAULT false,
    "requeuedAt" TIMESTAMP(3),
    "requeuedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_dead_letters_integratorUserId_createdAt_idx" ON "webhook_dead_letters"("integratorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_dead_letters_requeued_createdAt_idx" ON "webhook_dead_letters"("requeued", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "webhook_dead_letters" ADD CONSTRAINT "webhook_dead_letters_integratorUserId_fkey" FOREIGN KEY ("integratorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
