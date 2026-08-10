import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma, TradeStatus, TransactionType, type PrismaClient } from "@prisma/client";
import {
  TradeInvalidStatusError,
  TradeService,
} from "./trade.service.js";

type TxMock = {
  trade: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  wallet: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  transaction: {
    create: ReturnType<typeof vi.fn>;
  };
};

function createTxMock(): TxMock {
  return {
    trade: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
  };
}

describe("TradeService escrow release", () => {
  let lastTx: TxMock;
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let service: TradeService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
    lastTx = createTxMock();
    prisma = {
      $transaction: vi.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(lastTx)),
    };
    service = new TradeService(prisma as unknown as PrismaClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("payTrade sets expiresAt to a post-payment escrow window (72h)", async () => {
    lastTx.trade.findUnique.mockResolvedValue({
      id: "trade_1",
      sellerId: "seller_1",
      buyerId: null,
      status: TradeStatus.PENDING_PAYMENT,
      amountCents: 10_000n,
      platformFeeCents: 300n,
      expiresAt: new Date("2026-08-10T13:00:00.000Z"),
    });
    lastTx.wallet.findUnique.mockResolvedValue({ id: "wal_buyer", balance: 50_000n });
    lastTx.wallet.update.mockResolvedValue({});
    lastTx.transaction.create.mockResolvedValue({});
    lastTx.trade.update.mockResolvedValue({});

    await service.payTrade("trade_1", "buyer_1");

    expect(lastTx.trade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "trade_1" },
        data: expect.objectContaining({
          buyerId: "buyer_1",
          status: TradeStatus.PAID_AWAITING_ITEM,
          expiresAt: new Date("2026-08-13T12:00:00.000Z"),
        }),
      }),
    );
  });

  it("cancelByBuyer rejects while escrow window is still open", async () => {
    lastTx.trade.findUnique.mockResolvedValue({
      id: "trade_1",
      sellerId: "seller_1",
      buyerId: "buyer_1",
      status: TradeStatus.PAID_AWAITING_ITEM,
      amountCents: 10_000n,
      expiresAt: new Date("2026-08-13T12:00:00.000Z"),
    });

    await expect(service.cancelByBuyer("trade_1", "buyer_1")).rejects.toBeInstanceOf(
      TradeInvalidStatusError,
    );
    expect(lastTx.wallet.update).not.toHaveBeenCalled();
  });

  it("cancelByBuyer refunds escrow after expiresAt and cancels the trade", async () => {
    lastTx.trade.findUnique.mockResolvedValue({
      id: "trade_1",
      sellerId: "seller_1",
      buyerId: "buyer_1",
      status: TradeStatus.PAID_AWAITING_ITEM,
      amountCents: 10_000n,
      expiresAt: new Date("2026-08-09T12:00:00.000Z"),
    });
    lastTx.wallet.findUnique.mockResolvedValue({ id: "wal_buyer" });
    lastTx.wallet.update.mockResolvedValue({});
    lastTx.transaction.create.mockResolvedValue({});
    lastTx.trade.update.mockResolvedValue({});

    await service.cancelByBuyer("trade_1", "buyer_1");

    expect(lastTx.wallet.update).toHaveBeenCalledWith({
      where: { userId: "buyer_1" },
      data: { balance: { increment: 10_000n } },
    });
    expect(lastTx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletId: "wal_buyer",
          amount: 10_000n,
          referenceId: "trade:trade_1:cancel-refund",
          type: TransactionType.REFUND,
        }),
      }),
    );
    expect(lastTx.trade.update).toHaveBeenCalledWith({
      where: { id: "trade_1" },
      data: { status: TradeStatus.CANCELLED },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it("cancelByBuyer rejects non-buyer callers", async () => {
    lastTx.trade.findUnique.mockResolvedValue({
      id: "trade_1",
      sellerId: "seller_1",
      buyerId: "buyer_1",
      status: TradeStatus.PAID_AWAITING_ITEM,
      amountCents: 10_000n,
      expiresAt: new Date("2026-08-09T12:00:00.000Z"),
    });

    await expect(service.cancelByBuyer("trade_1", "stranger")).rejects.toBeInstanceOf(
      TradeInvalidStatusError,
    );
    expect(lastTx.wallet.update).not.toHaveBeenCalled();
  });
});
