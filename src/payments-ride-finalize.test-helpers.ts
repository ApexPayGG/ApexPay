import { SafeTaxiRideStatus, UserRole, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { vi } from "vitest";
import type { WebSocketService } from "./services/websocket.service.js";

export const rideFinalizeIntegratorUserId = "integrator_ride_finalize";

export const rideFinalizePayload = {
  ride_id: "ride_1",
  base_amount_grosze: 1000,
  platform_commission_grosze: 200,
  driver_base_payout_grosze: 800,
  tip_amount_grosze: 50,
  tip_settlement: "CREDIT_CONNECTED_ACCOUNT",
  passenger_rating_stars: 5,
  driver_connected_account_id: "ca_1",
};

export type RideFinalizeTestContextOptions = {
  passengerBalance?: bigint;
  rideStatus?: SafeTaxiRideStatus;
  rideDriverId?: string;
  connectedAccountUserId?: string;
  connectedAccountIntegratorUserId?: string;
  finalizeDebitExists?: boolean;
};

export function buildRideFinalizeContext(
  keyPrefix: string,
  keyHash: string,
  opts?: RideFinalizeTestContextOptions,
): {
  prisma: PrismaClient;
  tx: {
    wallet: { update: ReturnType<typeof vi.fn> };
    safeTaxiRide: { update: ReturnType<typeof vi.fn> };
  };
  createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }>;
} {
  const passengerBalance = opts?.passengerBalance ?? 10000n;
  const createdTransactions: Array<{ referenceId: string; amount: bigint; type: string }> = [];
  const rideDriverId = opts?.rideDriverId ?? "driver_user_1";
  const connectedAccountUserId = opts?.connectedAccountUserId ?? "driver_user_1";
  const connectedAccountIntegratorUserId =
    opts?.connectedAccountIntegratorUserId ?? rideFinalizeIntegratorUserId;
  const ride = {
    id: "ride_1",
    passengerId: "passenger_1",
    driverId: rideDriverId,
    status: opts?.rideStatus ?? SafeTaxiRideStatus.CREATED,
  };
  const connectedAccount = {
    id: "ca_1",
    userId: connectedAccountUserId,
    integratorUserId: connectedAccountIntegratorUserId,
  };

  const tx = {
    safeTaxiRide: {
      findUnique: vi.fn().mockResolvedValue(ride),
      update: vi.fn().mockResolvedValue({}),
    },
    connectedAccount: {
      findUnique: vi.fn().mockResolvedValue(connectedAccount),
    },
    wallet: {
      findUnique: vi.fn().mockImplementation((args: { where: { userId: string } }) => {
        if (args.where.userId === "passenger_1") {
          return Promise.resolve({ id: "w_passenger", balance: passengerBalance });
        }
        if (args.where.userId === connectedAccountUserId) {
          return Promise.resolve({ id: "w_driver" });
        }
        if (args.where.userId === "platform_1") {
          return Promise.resolve({ id: "w_platform" });
        }
        return Promise.resolve(null);
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      create: vi.fn().mockImplementation((args: { data: { referenceId: string; amount: bigint; type: string } }) => {
        createdTransactions.push({
          referenceId: args.data.referenceId,
          amount: args.data.amount,
          type: args.data.type,
        });
        return Promise.resolve({});
      }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    webhookOutbox: {
      create: vi.fn().mockResolvedValue({ id: "wo_1" }),
    },
  };

  const prisma = {
    apiKey: {
      findUnique: vi.fn().mockImplementation((args: { where: { prefix: string } }) => {
        if (args.where.prefix !== keyPrefix) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: "apikey_ride_finalize",
          keyHash,
          prefix: keyPrefix,
          isActive: true,
          expiresAt: null,
          user: { id: rideFinalizeIntegratorUserId, role: UserRole.PLAYER },
        });
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    safeTaxiRide: {
      findUnique: vi.fn().mockResolvedValue(ride),
    },
    connectedAccount: {
      findUnique: vi.fn().mockResolvedValue(connectedAccount),
    },
    transaction: {
      findUnique: vi.fn().mockResolvedValue(opts?.finalizeDebitExists === true ? { id: "txn_debit" } : null),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;

  return { prisma, tx, createdTransactions };
}

export function makeRideFinalizeRedis(
  setResult: "OK" | null = "OK",
  getResult: string | null = setResult === null ? "done" : null,
): Redis {
  return {
    ping: vi.fn().mockResolvedValue("PONG"),
    set: vi.fn().mockResolvedValue(setResult),
    get: vi.fn().mockResolvedValue(getResult),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

export function makeRideFinalizeWs(): WebSocketService {
  return { notifyWallet: vi.fn() } as unknown as WebSocketService;
}
