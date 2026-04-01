import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  InsufficientFundsError,
  TransferSelfError,
  WalletNotFoundError,
  WalletService,
} from "./wallet.service.js";

/** Minimalny kształt callbacka `prisma.$transaction` (izolacja od prawdziwej bazy). */
type TxMock = {
  wallet: {
    findUnique: ReturnType<typeof vi.fn>;
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
      findUnique: vi.fn(),
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

describe("WalletService.fundWalletAtomic", () => {
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let service: WalletService;
  let lastTx: TxMock;

  beforeEach(() => {
    lastTx = createTxMock();
    prisma = {
      $transaction: vi.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(lastTx)),
    };
    service = new WalletService(prisma as unknown as PrismaClient);
  });

  it("throws WalletNotFoundError when wallet row is missing", async () => {
    lastTx.wallet.findUnique.mockResolvedValue(null);

    await expect(service.fundWalletAtomic("missing-user", 100n)).rejects.toBeInstanceOf(
      WalletNotFoundError,
    );
    expect(lastTx.wallet.update).not.toHaveBeenCalled();
    expect(lastTx.transaction.create).not.toHaveBeenCalled();
  });

  it("increments balance and creates DEPOSIT Transaction with admin-fund referenceId", async () => {
    lastTx.wallet.findUnique.mockResolvedValue({ id: "wal_admin_fund" });
    lastTx.wallet.update.mockResolvedValue({ balance: 1100n });
    lastTx.transaction.create.mockResolvedValue({ id: "txn_af" });

    const result = await service.fundWalletAtomic("usr_target", 100n);

    expect(result).toEqual({ balance: 1100n });
    expect(lastTx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "usr_target" },
        data: { balance: { increment: 100n } },
      }),
    );
    expect(lastTx.transaction.create).toHaveBeenCalledTimes(1);
    const createArg = lastTx.transaction.create.mock.calls[0]?.[0] as {
      data: { referenceId: string; amount: bigint; type: string; walletId: string };
    };
    expect(createArg.data.walletId).toBe("wal_admin_fund");
    expect(createArg.data.amount).toBe(100n);
    expect(createArg.data.type).toBe("DEPOSIT");
    expect(createArg.data.referenceId).toMatch(/^admin-fund-[0-9a-f-]{36}$/i);
  });

  it("throws RangeError when amount is not positive", async () => {
    await expect(service.fundWalletAtomic("u1", 0n)).rejects.toThrow(RangeError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("WalletService.transferP2P", () => {
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let service: WalletService;
  let lastTx: TxMock;

  beforeEach(() => {
    lastTx = createTxMock();
    prisma = {
      $transaction: vi.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(lastTx)),
    };
    service = new WalletService(prisma as unknown as PrismaClient);
  });

  it("throws TransferSelfError when from === to", async () => {
    await expect(service.transferP2P("u1", "u1", 10n, "ref1")).rejects.toBeInstanceOf(
      TransferSelfError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns idempotent when p2p ref out already exists", async () => {
    lastTx.transaction.findFirst.mockResolvedValue({ id: "existing" });
    const r = await service.transferP2P("a", "b", 5n, "idem-1");
    expect(r).toEqual({ idempotent: true });
    expect(lastTx.wallet.update).not.toHaveBeenCalled();
  });

  it("debits and credits with two transaction rows", async () => {
    lastTx.transaction.findFirst.mockResolvedValue(null);
    lastTx.wallet.findUnique
      .mockResolvedValueOnce({ id: "wf" })
      .mockResolvedValueOnce({ id: "wt" });
    lastTx.wallet.update.mockResolvedValue({});
    lastTx.transaction.create.mockResolvedValue({ id: "tx" });

    const r = await service.transferP2P("from-u", "to-u", 100n, "x-1");
    expect(r).toEqual({ idempotent: false });
    expect(lastTx.wallet.update).toHaveBeenCalledTimes(2);
    expect(lastTx.transaction.create).toHaveBeenCalledTimes(2);
  });
});

describe("WalletService.listTransactionsAdmin", () => {
  it("maps rows and total", async () => {
    const createdAt = new Date("2026-02-01T12:00:00.000Z");
    const prisma = {
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t1",
            amount: 99n,
            referenceId: "ref-a",
            type: "DEPOSIT",
            createdAt,
            wallet: { userId: "usr_z" },
          },
        ]),
        count: vi.fn().mockResolvedValue(42),
      },
    };
    const service = new WalletService(prisma as unknown as PrismaClient);
    const out = await service.listTransactionsAdmin(5, 10);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 10 }),
    );
    expect(out.total).toBe(42);
    expect(out.items[0]).toMatchObject({
      id: "t1",
      amount: "99",
      referenceId: "ref-a",
      walletUserId: "usr_z",
    });
  });
});
