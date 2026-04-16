import { randomUUID } from "node:crypto";
import type { PrismaClient, Transaction, TransactionType } from "@prisma/client";
import { Prisma, TransactionType as TxType } from "@prisma/client";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";

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

export class TransferSelfError extends Error {
  constructor() {
    super("Cannot transfer to the same account");
    this.name = "TransferSelfError";
  }
}

export type AdminTransactionRow = {
  id: string;
  amount: string;
  referenceId: string;
  type: TransactionType;
  createdAt: Date;
  walletUserId: string;
};

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
          type: TxType.DEPOSIT,
          walletId: exists.id,
        },
      });

      return updated;
    });
  }

  /**
   * Przelew P2P: atomowy zapis (WITHDRAWAL u nadawcy, DEPOSIT u odbiorcy).
   * Idempotentnie po `referenceId` (para `p2p:{ref}:out` / `:in`).
   */
  async transferP2P(
    fromUserId: string,
    toUserId: string,
    amount: bigint,
    referenceId: string,
  ): Promise<{ idempotent: boolean }> {
    if (fromUserId === toUserId) {
      throw new TransferSelfError();
    }
    if (amount <= 0n) {
      throw new RangeError("Transfer amount must be strictly positive");
    }

    const base = referenceId.trim();
    if (base.length === 0) {
      throw new RangeError("referenceId is required");
    }
    const refOut = `p2p:${base}:out`;
    const refIn = `p2p:${base}:in`;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: { referenceId: refOut },
      });
      if (existing !== null) {
        return { idempotent: true };
      }

      const fromWallet = await tx.wallet.findUnique({
        where: { userId: fromUserId },
        select: { id: true },
      });
      const toWallet = await tx.wallet.findUnique({
        where: { userId: toUserId },
        select: { id: true },
      });
      if (fromWallet === null || toWallet === null) {
        throw new WalletNotFoundError();
      }

      try {
        await tx.wallet.update({
          where: { userId: fromUserId },
          data: { balance: { decrement: amount } },
        });
      } catch (err) {
        if (isInsufficientFundsDbError(err)) {
          throw new InsufficientFundsError();
        }
        throw err;
      }

      await tx.wallet.update({
        where: { userId: toUserId },
        data: { balance: { increment: amount } },
      });

      await tx.transaction.create({
        data: {
          walletId: fromWallet.id,
          amount: -amount,
          referenceId: refOut,
          type: TxType.WITHDRAWAL,
        },
      });
      await tx.transaction.create({
        data: {
          walletId: toWallet.id,
          amount,
          referenceId: refIn,
          type: TxType.DEPOSIT,
        },
      });

      return { idempotent: false };
    });
  }

  async listTransactionsAdmin(
    skip: number,
    take: number,
    options?: { referenceIdPrefix?: string },
  ): Promise<{ items: AdminTransactionRow[]; total: number }> {
    const raw = options?.referenceIdPrefix?.trim() ?? "";
    const prefix = raw.length > 0 ? raw.slice(0, 128) : "";
    const where =
      prefix.length > 0 ? { referenceId: { startsWith: prefix } } : {};

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { wallet: { select: { userId: true } } },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        amount: t.amount.toString(),
        referenceId: t.referenceId,
        type: t.type,
        createdAt: t.createdAt,
        walletUserId: t.wallet.userId,
      })),
      total,
    };
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
          type: TxType.DEPOSIT,
          walletId: wallet.id,
        },
      });
      return { transaction, created: true };
    });
  }

  /**
   * Wpłata z webhooka PSP: `referenceId` = `dep:{pspRefId}`, izolacja Serializable.
   * Używane razem z idempotencją Redis przed wywołaniem.
   */
  async depositFundsPspWebhook(
    userId: string,
    amount: bigint,
    pspRefId: string,
  ): Promise<{ transaction: Transaction; created: boolean }> {
    if (amount <= 0n) {
      throw new RangeError("Deposit amount must be strictly positive");
    }
    const trimmedRef = pspRefId.trim();
    if (trimmedRef.length === 0) {
      throw new RangeError("pspRefId is required");
    }
    const referenceId = `dep:${trimmedRef}`;

    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transaction.findFirst({
          where: { referenceId },
        });
        if (existing !== null) {
          return { transaction: existing, created: false };
        }

        const wallet = await tx.wallet.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (wallet === null) {
          throw new WalletNotFoundError();
        }

        await tx.wallet.update({
          where: { userId },
          data: { balance: { increment: amount } },
        });

        const transaction = await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount,
            referenceId,
            type: TxType.DEPOSIT,
          },
        });
        return { transaction, created: true };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    );
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
        if (isInsufficientFundsDbError(err)) {
          throw new InsufficientFundsError();
        }
        throw err;
      }

      return await tx.transaction.create({
        data: {
          walletId,
          amount: -amount,
          referenceId,
          type: TxType.FEE,
        },
      });
    });
  }
}
