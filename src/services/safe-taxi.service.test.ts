import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RidePaymentMethod,
  SafeTaxiRideStatus,
  TransactionType,
  type PrismaClient,
} from "@prisma/client";
import {
  DriverDebtLimitExceededError,
  SafeTaxiConfigError,
  SafeTaxiService,
  splitSafeTaxiFare,
} from "./safe-taxi.service.js";

describe("splitSafeTaxiFare", () => {
  it("15% z 10000 gr → 1500 + 8500", () => {
    const out = splitSafeTaxiFare(10000n, 1500n);
    expect(out.platformCents).toBe(1500n);
    expect(out.driverCents).toBe(8500n);
  });

  it("0% → całość dla kierowcy", () => {
    const out = splitSafeTaxiFare(5000n, 0n);
    expect(out.platformCents).toBe(0n);
    expect(out.driverCents).toBe(5000n);
  });

  it("odrzuca bps > 10000", () => {
    expect(() => splitSafeTaxiFare(100n, 10001n)).toThrow(SafeTaxiConfigError);
  });
});

describe("SafeTaxiService.settleRide — CASH (driver debt)", () => {
  beforeEach(() => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "user_platform");
    vi.stubEnv("SAFE_TAXI_PLATFORM_COMMISSION_BPS", "1500");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pobiera prowizję z kierowcy, nie dotyka pasażera; saldo kierowcy może być ujemne", async () => {
    const rideRow = {
      id: "ride_cash_1",
      passengerId: "user_pass",
      driverId: "user_driver",
      paymentMethod: RidePaymentMethod.CASH,
      status: SafeTaxiRideStatus.CREATED,
      fareCents: null,
      platformCommissionCents: null,
      driverPayoutCents: null,
      settledAt: null,
      createdAt: new Date(),
    };

    let driverBalance = 500n;
    let platformBalance = 0n;

    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue(rideRow),
        update: vi.fn().mockResolvedValue({}),
      },
      transaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      wallet: {
        findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
          if (args.where.userId === "user_driver") {
            return Promise.resolve({ id: "w_driver", balance: driverBalance });
          }
          if (args.where.userId === "user_platform") {
            return Promise.resolve({ id: "w_platform" });
          }
          return Promise.resolve(null);
        }),
        update: vi.fn().mockImplementation((args: { where: { userId: string }; data: { balance?: { decrement?: bigint; increment?: bigint } } }) => {
          const d = args.data.balance;
          if (args.where.userId === "user_driver" && d?.decrement !== undefined) {
            driverBalance -= d.decrement;
          }
          if (args.where.userId === "user_platform" && d?.increment !== undefined) {
            platformBalance += d.increment;
          }
          return Promise.resolve({});
        }),
      },
    };

    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const service = new SafeTaxiService(prisma);
    const out = await service.settleRide("ride_cash_1", 10000n);

    expect(out.idempotent).toBe(false);
    expect(out.platformCommissionCents).toBe(1500n);
    expect(out.driverPayoutCents).toBe(8500n);
    expect(platformBalance).toBe(1500n);
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: {
        walletId: "w_driver",
        amount: -1500n,
        referenceId: "stx:ride_cash_1:commission_cash",
        type: TransactionType.SAFE_TAXI_COMMISSION_DEBIT,
      },
    });
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: {
        walletId: "w_platform",
        amount: 1500n,
        referenceId: "stx:ride_cash_1:commission_cash:platform",
        type: TransactionType.SAFE_TAXI_COMMISSION_DEBIT,
      },
    });
    expect(driverBalance).toBe(-1000n);
  });

  it("rzuca DriverDebtLimitExceededError gdy po prowizji saldo spadnie poniżej MAX_DRIVER_DEBT", async () => {
    vi.stubEnv("MAX_DRIVER_DEBT", "-500");

    const rideRow = {
      id: "ride_cash_2",
      passengerId: "user_pass",
      driverId: "user_driver",
      paymentMethod: RidePaymentMethod.CASH,
      status: SafeTaxiRideStatus.CREATED,
      fareCents: null,
      platformCommissionCents: null,
      driverPayoutCents: null,
      settledAt: null,
      createdAt: new Date(),
    };

    const walletUpdate = vi.fn();
    const tx = {
      safeTaxiRide: {
        findUnique: vi.fn().mockResolvedValue(rideRow),
      },
      transaction: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "w_driver", balance: 0n }),
        update: walletUpdate,
      },
    };

    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;

    const service = new SafeTaxiService(prisma);
    await expect(service.settleRide("ride_cash_2", 10000n)).rejects.toBeInstanceOf(
      DriverDebtLimitExceededError,
    );
    expect(walletUpdate).not.toHaveBeenCalled();
  });
});

describe("SafeTaxiService — MAX_DRIVER_DEBT (config)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("odrzuca MAX_DRIVER_DEBT > 0 przy createRide CASH", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "p");
    vi.stubEnv("MAX_DRIVER_DEBT", "100");

    const prisma = {
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "w" }),
      },
      safeTaxiRide: { create: vi.fn() },
    } as unknown as PrismaClient;

    const service = new SafeTaxiService(prisma);
    await expect(
      service.createRide("a", "b", RidePaymentMethod.CASH),
    ).rejects.toBeInstanceOf(SafeTaxiConfigError);
  });

  it("blokuje nowy kurs CASH gdy saldo kierowcy już poniżej progu", async () => {
    vi.stubEnv("SAFE_TAXI_PLATFORM_USER_ID", "p");
    vi.stubEnv("MAX_DRIVER_DEBT", "-1000");

    const prisma = {
      wallet: {
        findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
          if (args.where.userId === "b") {
            return Promise.resolve({ id: "wd", balance: -1001n });
          }
          return Promise.resolve({ id: "wp" });
        }),
      },
      safeTaxiRide: { create: vi.fn() },
    } as unknown as PrismaClient;

    const service = new SafeTaxiService(prisma);
    await expect(
      service.createRide("a", "b", RidePaymentMethod.CASH),
    ).rejects.toBeInstanceOf(DriverDebtLimitExceededError);
    expect(prisma.safeTaxiRide.create).not.toHaveBeenCalled();
  });
});
