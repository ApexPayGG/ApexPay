-- CreateTable
CREATE TABLE "autopay_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autopay_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "autopay_orders_userId_createdAt_idx" ON "autopay_orders"("userId", "createdAt");

ALTER TABLE "autopay_orders" ADD CONSTRAINT "autopay_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
