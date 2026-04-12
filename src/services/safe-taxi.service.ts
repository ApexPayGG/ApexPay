import {
  Prisma,
  type PrismaClient,
  SafeTaxiRideStatus,
  TransactionType as TxType,
} from "@prisma/client";
import { InsufficientFundsError, WalletNotFoundError } from "./wallet.service.js";

function isInsufficientFundsDbError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (err.code === "P2025") {
    return true;
  }
  const meta = err.meta as { constraint?: string } | undefined;
  if (meta?.constraint === "wallet_balance_check") {
    return true;
  }
  return err.message.includes("wallet_balance_check");
}

export class SafeTaxiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeTaxiConfigError";
  }
}

export class SafeTaxiRideNotFoundError extends Error {
  constructor() {
    super("Ride not found");
    this.name = "SafeTaxiRideNotFoundError";
  }
}

export class SafeTaxiInvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeTaxiInvalidStateError";
  }
}

/** Podział taryfy (grosze) — prowizja platformy w basis points (0–10000). */
export function splitSafeTaxiFare(
  fareCents: bigint,
  commissionBps: bigint,
): { platformCents: bigint; driverCents: bigint } {
  if (commissionBps < 0n || commissionBps > 10000n) {
    throw new SafeTaxiConfigError("commissionBps musi być 0–10000.");
  }
  const platformCents = (fareCents * commissionBps) / 10000n;
  return { platformCents, driverCents: fareCents - platformCents };
}

/** Rozliczenie przejazdu: pasażer płaci fare → podział na kierowcę i konto platformy (prowizja w basis points). */
export class SafeTaxiService {
  constructor(private readonly prisma: PrismaClient) {}

  private platformUserId(): string {
    const raw = process.env.SAFE_TAXI_PLATFORM_USER_ID?.trim();
    if (raw === undefined || raw.length === 0) {
      throw new SafeTaxiConfigError(
        "Brak SAFE_TAXI_PLATFORM_USER_ID — utwórz użytkownika-konto platformy i ustaw jego CUID w .env.",
      );
    }
    return raw;
  }

  private commissionBps(): bigint {
    const raw = process.env.SAFE_TAXI_PLATFORM_COMMISSION_BPS?.trim() ?? "1500";
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 10_000) {
      throw new SafeTaxiConfigError(
        "SAFE_TAXI_PLATFORM_COMMISSION_BPS musi być liczbą 0–10000 (np. 1500 = 15%).",
      );
    }
    return BigInt(Math.trunc(n));
  }

  async getRideDriverId(rideId: string): Promise<string | null> {
    const row = await this.prisma.safeTaxiRide.findUnique({
      where: { id: rideId },
      select: { driverId: true },
    });
    return row?.driverId ?? null;
  }

  async createRide(passengerId: string, driverId: string): Promise<{ rideId: string }> {
    if (passengerId === driverId) {
      throw new SafeTaxiInvalidStateError("Pasażer i kierowca muszą być różnymi użytkownikami.");
    }

    const [pw, dw] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: passengerId }, select: { id: true } }),
      this.prisma.wallet.findUnique({ where: { userId: driverId }, select: { id: true } }),
    ]);
    if (pw === null || dw === null) {
      throw new WalletNotFoundError();
    }

    const ride = await this.prisma.safeTaxiRide.create({
      data: {
        passengerId,
        driverId,
        status: SafeTaxiRideStatus.CREATED,
      },
      select: { id: true },
    });
    return { rideId: ride.id };
  }

  /**
   * Atomowe rozliczenie: jeden charge u pasażera, wpływy u kierowcy i platformy.
   * Idempotentnie po referenceId pierwszej transakcji (`stx:{rideId}:passenger`).
   */
  async settleRide(rideId: string, fareCents: bigint): Promise<{
    idempotent: boolean;
    platformCommissionCents: bigint;
    driverPayoutCents: bigint;
  }> {
    if (fareCents < 100n) {
      throw new SafeTaxiInvalidStateError("Minimalna taryfa to 100 groszy (1,00 PLN).");
    }

    const platformUserId = this.platformUserId();
    const bps = this.commissionBps();
    const { platformCents: platformCut, driverCents: driverCut } = splitSafeTaxiFare(
      fareCents,
      bps,
    );

    const refPassenger = `stx:${rideId}:passenger`;

    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transaction.findUnique({
          where: { referenceId: refPassenger },
        });
        if (existing !== null) {
          const ride = await tx.safeTaxiRide.findUnique({
            where: { id: rideId },
            select: {
              platformCommissionCents: true,
              driverPayoutCents: true,
            },
          });
          if (ride === null) {
            throw new SafeTaxiRideNotFoundError();
          }
          return {
            idempotent: true,
            platformCommissionCents: ride.platformCommissionCents ?? 0n,
            driverPayoutCents: ride.driverPayoutCents ?? 0n,
          };
        }

        const ride = await tx.safeTaxiRide.findUnique({
          where: { id: rideId },
        });
        if (ride === null) {
          throw new SafeTaxiRideNotFoundError();
        }
        if (ride.status !== SafeTaxiRideStatus.CREATED) {
          throw new SafeTaxiInvalidStateError("Przejazd nie oczekuje na rozliczenie.");
        }

        const [passengerW, driverW, platformW] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: ride.passengerId },
            select: { id: true },
          }),
          tx.wallet.findUnique({
            where: { userId: ride.driverId },
            select: { id: true },
          }),
          tx.wallet.findUnique({
            where: { userId: platformUserId },
            select: { id: true },
          }),
        ]);

        if (passengerW === null || driverW === null || platformW === null) {
          throw new WalletNotFoundError();
        }

        try {
          await tx.wallet.update({
            where: { userId: ride.passengerId },
            data: { balance: { decrement: fareCents } },
          });
        } catch (err) {
          if (isInsufficientFundsDbError(err)) {
            throw new InsufficientFundsError();
          }
          throw err;
        }

        await tx.wallet.update({
          where: { userId: ride.driverId },
          data: { balance: { increment: driverCut } },
        });
        await tx.wallet.update({
          where: { userId: platformUserId },
          data: { balance: { increment: platformCut } },
        });

        await tx.transaction.create({
          data: {
            walletId: passengerW.id,
            amount: -fareCents,
            referenceId: refPassenger,
            type: TxType.SAFE_TAXI_PASSENGER_CHARGE,
          },
        });
        await tx.transaction.create({
          data: {
            walletId: driverW.id,
            amount: driverCut,
            referenceId: `stx:${rideId}:driver`,
            type: TxType.SAFE_TAXI_DRIVER_PAYOUT,
          },
        });
        await tx.transaction.create({
          data: {
            walletId: platformW.id,
            amount: platformCut,
            referenceId: `stx:${rideId}:platform`,
            type: TxType.SAFE_TAXI_PLATFORM_FEE,
          },
        });

        await tx.safeTaxiRide.update({
          where: { id: rideId },
          data: {
            status: SafeTaxiRideStatus.SETTLED,
            fareCents,
            platformCommissionCents: platformCut,
            driverPayoutCents: driverCut,
            settledAt: new Date(),
          },
        });

        return {
          idempotent: false,
          platformCommissionCents: platformCut,
          driverPayoutCents: driverCut,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    );
  }
}
