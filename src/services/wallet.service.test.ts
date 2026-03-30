import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { InsufficientFundsError, WalletService } from "./wallet.service.js";

/** Minimalny kształt callbacka `prisma.$transaction` (izolacja od prawdziwej bazy). */
type TxMock = {
  wallet: {
    update: ReturnType<typeof vi.fn>;
  };
  transaction: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function createTxMock(overrides: Partial<TxMock> = {}): TxMock {
  return {
    wallet: {
      update: vi.fn(),
      ...overrides.wallet,
    },
    transaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
      ...overrides.transaction,
    },
  };
}

describe("WalletService.processEntryFee", () => {
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: WalletService;
  let lastTx: TxMock;

  beforeEach(() => {
    lastTx = createTxMock();
    prisma = {
      $transaction: vi.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(lastTx)),
    };
    service = new WalletService(prisma as unknown as PrismaClient);
  });

  it("runs inside prisma.$transaction, atomically debits wallet and persists Transaction", async () => {
    const userId = "usr_1";
    const amount = 25n;
    const referenceId = "match-lobby-7";

    lastTx.transaction.findFirst.mockResolvedValue(null);
    lastTx.wallet.update.mockResolvedValue({ id: "wal_1" });
    const created = {
      id: "txn_1",
      walletId: "wal_1",
      amount: -amount,
      referenceId,
      createdAt: new Date(),
    };
    lastTx.transaction.create.mockResolvedValue(created);

    const result = await service.processEntryFee(userId, amount, referenceId);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(lastTx.transaction.findFirst).toHaveBeenCalled();
    expect(lastTx.wallet.update).toHaveBeenCalledTimes(1);
    expect(lastTx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: { balance: { decrement: amount } },
        select: { id: true },
      }),
    );
    expect(lastTx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletId: "wal_1",
          amount: -amount,
          referenceId,
        }),
      }),
    );
    expect(result).toEqual(created);
  });

  it("throws InsufficientFundsError when wallet.update fails (e.g. CHECK constraint / brak wiersza)", async () => {
    const userId = "usr_2";
    const amount = 50n;
    const referenceId = "match-lobby-8";

    lastTx.transaction.findFirst.mockResolvedValue(null);
    lastTx.wallet.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Check constraint "wallet_balance_check" violated',
        {
          code: "P2034",
          clientVersion: "test",
        },
      ),
    );

    await expect(service.processEntryFee(userId, amount, referenceId)).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );

    expect(lastTx.transaction.create).not.toHaveBeenCalled();
  });

  it("returns existing Transaction when referenceId already exists (idempotent success)", async () => {
    const userId = "usr_3";
    const amount = 10n;
    const referenceId = "idem-001";

    const existing = {
      id: "existing_txn",
      referenceId,
      walletId: "wal_3",
      amount: -amount,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    lastTx.transaction.findFirst.mockResolvedValue(existing);

    const result = await service.processEntryFee(userId, amount, referenceId);

    expect(result).toEqual(existing);
    expect(lastTx.wallet.update).not.toHaveBeenCalled();
    expect(lastTx.transaction.create).not.toHaveBeenCalled();
  });
});

describe("WalletService.depositFunds", () => {
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: WalletService;
  let lastTx: TxMock;

  beforeEach(() => {
    lastTx = createTxMock();
    prisma = {
      $transaction: vi.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(lastTx)),
    };
    service = new WalletService(prisma as unknown as PrismaClient);
  });

  it("runs inside prisma.$transaction with wallet.update increment and Transaction create (positive amount, type DEPOSIT)", async () => {
    const userId = "usr_dep_1";
    const amount = 5000n;
    const referenceId = "stripe-in-001";

    lastTx.transaction.findFirst.mockResolvedValue(null);
    lastTx.wallet.update.mockResolvedValue({ id: "wal_dep_1" });
    const created = {
      id: "txn_dep_1",
      walletId: "wal_dep_1",
      amount,
      referenceId,
      type: "DEPOSIT",
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
    };
    lastTx.transaction.create.mockResolvedValue(created);

    const result = await service.depositFunds(userId, amount, referenceId);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(lastTx.transaction.findFirst).toHaveBeenCalled();
    expect(lastTx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: { balance: { increment: amount } },
        select: { id: true },
      }),
    );
    expect(lastTx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletId: "wal_dep_1",
          amount,
          referenceId,
          type: "DEPOSIT",
        }),
      }),
    );
    expect(result).toEqual({ transaction: created, created: true });
  });

  it("throws RangeError when amount is zero or negative", async () => {
    await expect(service.depositFunds("usr_x", 0n, "ref-zero")).rejects.toThrow(RangeError);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await expect(service.depositFunds("usr_x", -100n, "ref-neg")).rejects.toThrow(RangeError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns existing Transaction for referenceId without wallet.update or transaction.create (idempotent)", async () => {
    const userId = "usr_dep_2";
    const amount = 100n;
    const referenceId = "idem-deposit-1";

    const existing = {
      id: "existing_dep_txn",
      referenceId,
      walletId: "wal_dep_2",
      amount: 100n,
      type: "DEPOSIT",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    lastTx.transaction.findFirst.mockResolvedValue(existing);

    const result = await service.depositFunds(userId, amount, referenceId);

    expect(result).toEqual({ transaction: existing, created: false });
    expect(lastTx.wallet.update).not.toHaveBeenCalled();
    expect(lastTx.transaction.create).not.toHaveBeenCalled();
  });
});
