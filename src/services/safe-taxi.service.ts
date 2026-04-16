import {
  Prisma,
  type PrismaClient,
  RidePaymentMethod,
  SafeTaxiRideStatus,
  TransactionType as TxType,
} from "@prisma/client";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";
import { InsufficientFundsError, WalletNotFoundError } from "./wallet.service.js";

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

/** Przekroczono dozwolone zadłużenie portfela kierowcy (gotówka / prowizja). */
export class DriverDebtLimitExceededError extends Error {
  constructor() {
    super("Przekroczono limit zadłużenia kierowcy — doładuj konto ApexPay.");
    this.name = "DriverDebtLimitExceededError";
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

/** Rozliczenie przejazdu: CARD — z portfela pasażera; CASH — prowizja z portfela kierowcy (model zadłużenia). */
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

  /**
   * Dolne dopuszczalne saldo kierowcy (minor units), np. -10000 = -100 PLN.
   * `MAX_DRIVER_DEBT` (≤ 0) albo legacy `MAX_DRIVER_DEBT_MINOR_UNITS` (≥ 0 → floor = -wartość).
   * Puste = brak limitu.
   */
  private maxDriverDebtFloor(): bigint | null {
    const debtRaw = process.env.MAX_DRIVER_DEBT?.trim();
    if (debtRaw !== undefined && debtRaw.length > 0) {
      if (!/^-?\d+$/.test(debtRaw)) {
        throw new SafeTaxiConfigError(
          "MAX_DRIVER_DEBT musi być liczbą całkowitą ≤ 0 (minor units, np. -10000 dla -100 PLN).",
        );
      }
      const v = BigInt(debtRaw);
      if (v > 0n) {
        throw new SafeTaxiConfigError("MAX_DRIVER_DEBT musi być ≤ 0.");
      }
      return v;
    }
    const legacy = process.env.MAX_DRIVER_DEBT_MINOR_UNITS?.trim();
    if (legacy !== undefined && legacy.length > 0) {
      if (!/^\d+$/.test(legacy)) {
        throw new SafeTaxiConfigError(
          "MAX_DRIVER_DEBT_MINOR_UNITS musi być nieujemną liczbą całkowitą (interpretacja: saldo ≥ -wartość).",
        );
      }
      return -BigInt(legacy);
    }
    return null;
  }

  private assertBalanceAfterCommissionOk(driverBalance: bigint, platformCut: bigint): void {
    const floor = this.maxDriverDebtFloor();
    if (floor === null) {
      return;
    }
    if (driverBalance - platformCut < floor) {
      throw new DriverDebtLimitExceededError();
    }
  }

  private async assertDriverWithinDebtLimitForNewCashRide(driverId: string): Promise<void> {
    const floor = this.maxDriverDebtFloor();
    if (floor === null) {
      return;
    }
    const w = await this.prisma.wallet.findUnique({
      where: { userId: driverId },
      select: { balance: true },
    });
    if (w === null) {
      throw new WalletNotFoundError();
    }
    if (w.balance < floor) {
      throw new DriverDebtLimitExceededError();
    }
  }

  async getRideDriverId(rideId: string): Promise<string | null> {
    const row = await this.prisma.safeTaxiRide.findUnique({
      where: { id: rideId },
      select: { driverId: true },
    });
    return row?.driverId ?? null;
  }

  async createRide(
    passengerId: string,
    driverId: string,
    paymentMethod: RidePaymentMethod = RidePaymentMethod.CARD,
  ): Promise<{ rideId: string }> {
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

    if (paymentMethod === RidePaymentMethod.CASH) {
      await this.assertDriverWithinDebtLimitForNewCashRide(driverId);
    }

    const ride = await this.prisma.safeTaxiRide.create({
      data: {
        passengerId,
        driverId,
        paymentMethod,
        status: SafeTaxiRideStatus.CREATED,
      },
      select: { id: true },
    });
    return { rideId: ride.id };
  }

  /**
   * Atomowe rozliczenie:
   * - CARD: debet pasażera, split kierowca / platforma (jak dotąd).
   * - CASH: bez debetu pasażera; prowizja z kierowcy → platforma (`SAFE_TAXI_COMMISSION_DEBIT`).
   * Idempotencja: CARD — `stx:{rideId}:passenger`; CASH — `stx:{rideId}:commission_cash`.
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
    const refCashCommission = `stx:${rideId}:commission_cash`;
    const refCashCommissionPlatform = `stx:${rideId}:commission_cash:platform`;

    return this.prisma.$transaction(
      async (tx) => {
        const ride = await tx.safeTaxiRide.findUnique({
          where: { id: rideId },
        });
        if (ride === null) {
          throw new SafeTaxiRideNotFoundError();
        }
        if (ride.status === SafeTaxiRideStatus.SETTLED) {
          return {
            idempotent: true,
            platformCommissionCents: ride.platformCommissionCents ?? 0n,
            driverPayoutCents: ride.driverPayoutCents ?? 0n,
          };
        }
        if (ride.status !== SafeTaxiRideStatus.CREATED) {
          throw new SafeTaxiInvalidStateError("Przejazd nie oczekuje na rozliczenie.");
        }

        if (ride.paymentMethod === RidePaymentMethod.CASH) {
          const existingCash = await tx.transaction.findUnique({
            where: { referenceId: refCashCommission },
          });
          if (existingCash !== null) {
            const r = await tx.safeTaxiRide.findUnique({
              where: { id: rideId },
              select: {
                platformCommissionCents: true,
                driverPayoutCents: true,
              },
            });
            if (r === null) {
              throw new SafeTaxiRideNotFoundError();
            }
            return {
              idempotent: true,
              platformCommissionCents: r.platformCommissionCents ?? 0n,
              driverPayoutCents: r.driverPayoutCents ?? 0n,
            };
          }

          const [driverW, platformW] = await Promise.all([
            tx.wallet.findUnique({
              where: { userId: ride.driverId },
              select: { id: true, balance: true },
            }),
            tx.wallet.findUnique({
              where: { userId: platformUserId },
              select: { id: true },
            }),
          ]);

          if (driverW === null || platformW === null) {
            throw new WalletNotFoundError();
          }

          if (platformCut > 0n) {
            this.assertBalanceAfterCommissionOk(driverW.balance, platformCut);

            try {
              await tx.wallet.update({
                where: { userId: ride.driverId },
                data: { balance: { decrement: platformCut } },
              });
            } catch (err) {
              if (isInsufficientFundsDbError(err)) {
                throw new InsufficientFundsError();
              }
              throw err;
            }

            await tx.wallet.update({
              where: { userId: platformUserId },
              data: { balance: { increment: platformCut } },
            });

            await tx.transaction.create({
              data: {
                walletId: driverW.id,
                amount: -platformCut,
                referenceId: refCashCommission,
                type: TxType.SAFE_TAXI_COMMISSION_DEBIT,
              },
            });
            await tx.transaction.create({
              data: {
                walletId: platformW.id,
                amount: platformCut,
                referenceId: refCashCommissionPlatform,
                type: TxType.SAFE_TAXI_COMMISSION_DEBIT,
              },
            });
          }

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
        }

        const existing = await tx.transaction.findUnique({
          where: { referenceId: refPassenger },
        });
        if (existing !== null) {
          const r = await tx.safeTaxiRide.findUnique({
            where: { id: rideId },
            select: {
              platformCommissionCents: true,
              driverPayoutCents: true,
            },
          });
          if (r === null) {
            throw new SafeTaxiRideNotFoundError();
          }
          return {
            idempotent: true,
            platformCommissionCents: r.platformCommissionCents ?? 0n,
            driverPayoutCents: r.driverPayoutCents ?? 0n,
          };
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
