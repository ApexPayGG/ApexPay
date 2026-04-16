-- RidePaymentMethod + SAFE TAXI gotówka (prowizja z portfela kierowcy).
-- Uwaga: kolumna Wallet.balance (BIGINT) nie ma w migracjach constraintu CHECK >= 0 — saldo może być ujemne (zadłużenie kierowcy).

-- CreateEnum
CREATE TYPE "RidePaymentMethod" AS ENUM ('CARD', 'CASH');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'CASH_COMMISSION_FEE';

-- AlterTable
ALTER TABLE "safe_taxi_rides" ADD COLUMN "paymentMethod" "RidePaymentMethod" NOT NULL DEFAULT 'CARD';
