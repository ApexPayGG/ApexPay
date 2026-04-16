-- CreateTable
CREATE TABLE "integrator_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrator_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integrator_configs_userId_key" ON "integrator_configs"("userId");

ALTER TABLE "integrator_configs" ADD CONSTRAINT "integrator_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
