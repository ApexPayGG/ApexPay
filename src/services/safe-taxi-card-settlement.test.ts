import {
  RidePaymentMethod,
  SafeTaxiRideStatus,
  type PrismaClient,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeTaxiService } from "./safe-taxi.service.js";
import { InsufficientFundsError } from "./wallet.service.js";

describe("SafeTaxiService.settleRide — CARD", () => {
  beforeEach(() => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "user_platform");
    vi.stubEnv("SAFE_TAXI_PLATFORM_COMMISSION_BPS", "1500");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an insufficient passenger balance before crediting recipients", async () => {
    const walletUpdate = vi.fn().mockResolvedValue({});
    const walletUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transactionCreate = vi.fn().mockResolvedValue({});
    const rideUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ride_card_1",
          passengerId: "user_passenger",
          driverId: "user_driver",
          paymentMethod: RidePaymentMethod.CARD,
          status: SafeTaxiRideStatus.CREATED,
          fareCents: null,
          platformCommissionCents: null,
          driverPayoutCents: null,
          settledAt: null,
          createdAt: new Date(),
        }),
        update: rideUpdate,
      },
      transaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: transactionCreate,
      },
      wallet: {
        findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) =>
          Promise.resolve({ id: `wallet_${args.where.userId}` }),
        ),
        update: walletUpdate,
        updateMany: walletUpdateMany,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    await expect(
      new SafeTaxiService(prisma).settleRide("ride_card_1", 10_000n),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect(walletUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user_passenger",
        balance: { gte: 10_000n },
      },
      data: { balance: { decrement: 10_000n } },
    });
    expect(walletUpdate).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
    expect(rideUpdate).not.toHaveBeenCalled();
  });
});
