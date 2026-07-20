import { describe, expect, it, vi } from "vitest";
import {
  RidePaymentMethod,
  SafeTaxiRideStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  SafeTaxiInvalidStateError,
  SafeTaxiService,
} from "./safe-taxi.service.js";

describe("SafeTaxiService.settleRide — legacy ride-finalize protection", () => {
  it.each([RidePaymentMethod.CARD, RidePaymentMethod.CASH])(
    "odrzuca ponowne rozliczenie %s, gdy istnieje trwała wypłata z endpointu ride-finalize",
    async (paymentMethod) => {
      vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "user_platform");
      vi.stubEnv("SAFE_TAXI_PLATFORM_COMMISSION_BPS", "1500");

      const tx = {
        safeTaxiRide: {
          findUnique: vi.fn().mockResolvedValue({
            id: "ride_legacy_finalize",
            passengerId: "user_pass",
            driverId: "user_driver",
            paymentMethod,
            status: SafeTaxiRideStatus.CREATED,
            fareCents: null,
            platformCommissionCents: null,
            driverPayoutCents: null,
            settledAt: null,
            createdAt: new Date(),
          }),
          update: vi.fn(),
        },
        transaction: {
          findUnique: vi.fn().mockImplementation(
            (args: { where: { referenceId: string } }) =>
              Promise.resolve(
                args.where.referenceId === "ride:ride_legacy_finalize:driver"
                  ? { id: "legacy_driver_payout" }
                  : null,
              ),
          ),
          create: vi.fn(),
        },
        wallet: {
          findUnique: vi.fn().mockResolvedValue({ id: "wallet" }),
          update: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const prisma = {
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
          fn(tx),
        ),
      } as unknown as PrismaClient;

      await expect(
        new SafeTaxiService(prisma).settleRide(
          "ride_legacy_finalize",
          10000n,
        ),
      ).rejects.toBeInstanceOf(SafeTaxiInvalidStateError);

      expect(tx.wallet.updateMany).not.toHaveBeenCalled();
      expect(tx.wallet.update).not.toHaveBeenCalled();
      expect(tx.transaction.create).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    },
  );
});
