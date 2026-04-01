import { randomUUID } from "node:crypto";
import type { PrismaClient, Transaction } from "@prisma/client";
import { Prisma, TransactionType } from "@prisma/client";

export class InsufficientFundsError extends Error {
  constructor() {
    super("Insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

/** Zarezerwowane na przyszłe przypadki (np. jawny konflikt); `processEntryFee` jest idempotentny po `referenceId`. */
export class DuplicateTransactionError extends Error {
  constructor() {
    super("Duplicate transaction");
    this.name = "DuplicateTransactionError";
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super("Wallet not found");
    this.name = "WalletNotFoundError";
  }
}

export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  async getWalletForUser(
    userId: string,
  ): Promise<{ id: string; balance: bigint; updatedAt: Date } | null> {
    return this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, balance: true, updatedAt: true },
    });
  }

  /**
   * Zasilenie salda (tylko wywołania z warstwy admin). Atomowy `increment` — bezpiecznie przy równoległych operacjach.
   */
  async fundWalletAtomic(targetUserId: string, amount: bigint): Promise<{ balance: bigint }> {
    if (amount <= 0n) {
      throw new RangeError("Amount must be strictly positive");
    }

    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.wallet.findUnique({
        where: { userId: targetUserId },
        select: { id: true },
      });
      if (exists === null) {
        throw new WalletNotFoundError();
      }

      const updated = await tx.wallet.update({
        where: { userId: targetUserId },
        data: { balance: { increment: amount } },
        select: { balance: true },
      });

      const referenceId = `admin-fund-${randomUUID()}`;
      await tx.transaction.create({
        data: {
          amount,
          referenceId,
          type: TransactionType.DEPOSIT,
          walletId: exists.id,
        },
      });

      return updated;
    });
  }

  async depositFunds(
    userId: string,
    amount: bigint,
    referenceId: string,
  ): Promise<{ transaction: Transaction; created: boolean }> {
    if (amount <= 0n) {
      throw new RangeError("Deposit amount must be strictly positive");
    }

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { referenceId },
      });
      if (existing !== null) {
        return { transaction: existing, created: false };
      }

      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amount } },
        select: { id: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          amount,
          referenceId,
          type: TransactionType.DEPOSIT,
          walletId: wallet.id,
        },
      });
      return { transaction, created: true };
    });
  }

  async processEntryFee(
    userId: string,
    amount: bigint,
    referenceId: string,
  ): Promise<Transaction> {
    if (amount <= 0n) {
      throw new RangeError("Entry fee amount must be positive");
    }

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { referenceId },
      });
      if (existing !== null) {
        return existing;
      }

      let walletId: string;
      try {
        const updated = await tx.wallet.update({
          where: { userId },
          data: { balance: { decrement: amount } },
          select: { id: true },
        });
        walletId = updated.id;
      } catch (err) {
        if (this.isInsufficientFundsDbError(err)) {
          throw new InsufficientFundsError();
        }
        throw err;
      }

      return await tx.transaction.create({
        data: {
          walletId,
          amount: -amount,
          referenceId,
          type: TransactionType.FEE,
        },
      });
    });
  }

  private isInsufficientFundsDbError(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (err.code === "P2025") {
      return true;
    }
    if (err.message.includes("wallet_balance_check")) {
      return true;
    }
    const meta = err.meta as { constraint?: string } | undefined;
    if (meta?.constraint === "wallet_balance_check") {
      return true;
    }
    return false;
  }
}
