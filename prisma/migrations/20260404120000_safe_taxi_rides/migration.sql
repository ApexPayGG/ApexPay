-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'DRIVER';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SAFE_TAXI_PASSENGER_CHARGE';
ALTER TYPE "TransactionType" ADD VALUE 'SAFE_TAXI_DRIVER_PAYOUT';
ALTER TYPE "TransactionType" ADD VALUE 'SAFE_TAXI_PLATFORM_FEE';

-- CreateEnum
CREATE TYPE "SafeTaxiRideStatus" AS ENUM ('CREATED', 'SETTLED', 'CANCELED');

-- CreateTable
CREATE TABLE "safe_taxi_rides" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "SafeTaxiRideStatus" NOT NULL DEFAULT 'CREATED',
    "fareCents" BIGINT,
    "platformCommissionCents" BIGINT,
    "driverPayoutCents" BIGINT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safe_taxi_rides_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "safe_taxi_rides" ADD CONSTRAINT "safe_taxi_rides_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "safe_taxi_rides" ADD CONSTRAINT "safe_taxi_rides_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "safe_taxi_rides_passengerId_createdAt_idx" ON "safe_taxi_rides"("passengerId", "createdAt" DESC);

CREATE INDEX "safe_taxi_rides_driverId_status_idx" ON "safe_taxi_rides"("driverId", "status");
