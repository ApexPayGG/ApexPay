-- CreateEnum
CREATE TYPE "PaymentMethodProvider" AS ENUM ('STRIPE', 'ADYEN', 'MOCK_PSP');

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentMethodProvider" NOT NULL,
    "token" TEXT NOT NULL,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "type" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_methods_provider_token_key" ON "payment_methods"("provider", "token");

CREATE INDEX "payment_methods_userId_createdAt_idx" ON "payment_methods"("userId", "createdAt" DESC);

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
