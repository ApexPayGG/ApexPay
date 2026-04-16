import { randomUUID } from "node:crypto";
import {
  Prisma,
  TradeStatus,
  TransactionType as TxType,
  type PrismaClient,
} from "@prisma/client";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";

const PLATFORM_FEE_PERCENT = 3;

export class TradeNotFoundError extends Error {
  constructor() {
    super("Trade not found");
    this.name = "TradeNotFoundError";
  }
}

export class TradeInvalidStatusError extends Error {
  constructor(msg = "Invalid trade status") {
    super(msg);
    this.name = "TradeInvalidStatusError";
  }
}

export class TradeExpiredError extends Error {
  constructor() {
    super("Trade offer expired");
    this.name = "TradeExpiredError";
  }
}

export class TradePlatformConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradePlatformConfigError";
  }
}

function platformUserIdFromEnv(): string {
  const a = process.env.APEXPAY_PLATFORM_USER_ID?.trim();
  if (a !== undefined && a.length > 0) {
    return a;
  }
  const b = process.env.SAFE_TAXI_PLATFORM_USER_ID?.trim();
  if (b !== undefined && b.length > 0) {
    return b;
  }
  throw new TradePlatformConfigError(
    "Brak APEXPAY_PLATFORM_USER_ID lub SAFE_TAXI_PLATFORM_USER_ID (prowizja trade).",
  );
}

export class TradeService {
  constructor(private readonly prisma: PrismaClient) {}

  async createTrade(
    sellerId: string,
    input: {
      itemName: string;
      description?: string;
      amountCents: number;
      expiresInHours?: number;
    },
  ): Promise<{ tradeId: string; tradeLink: string }> {
    if (input.amountCents <= 0) {
      throw new RangeError("amountCents must be positive");
    }
    const platformFeeCents = BigInt(
      Math.max(0, Math.round((input.amountCents * PLATFORM_FEE_PERCENT) / 100)),
    );
    const gross = BigInt(input.amountCents);
    if (platformFeeCents >= gross) {
      throw new RangeError("Platform fee would exceed or equal trade amount");
    }

    const expiresAt = input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 3600 * 1000)
      : new Date(Date.now() + 72 * 3600 * 1000);

    const trade = await this.prisma.trade.create({
      data: {
        sellerId,
        itemName: input.itemName.trim(),
        description: input.description?.trim() ?? null,
        amountCents: gross,
        platformFeeCents,
        expiresAt,
      },
    });

    const baseUrl = process.env.APP_BASE_URL?.trim() ?? "http://localhost:5178";
    return {
      tradeId: trade.id,
      tradeLink: `${baseUrl}/trade/${trade.id}`,
    };
  }

  async getTrade(tradeId: string): Promise<{
    tradeId: string;
    sellerId: string;
    buyerId: string | null;
    itemName: string;
    description: string | null;
    amountCents: string;
    platformFeeCents: string;
    status: TradeStatus;
    sellerEmail: string;
    expiresAt: string | null;
    createdAt: string;
  }> {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: { seller: { select: { email: true } } },
    });
    if (trade === null) {
      throw new TradeNotFoundError();
    }

    return {
      tradeId: trade.id,
      sellerId: trade.sellerId,
      buyerId: trade.buyerId,
      itemName: trade.itemName,
      description: trade.description,
      amountCents: trade.amountCents.toString(),
      platformFeeCents: trade.platformFeeCents.toString(),
      status: trade.status,
      sellerEmail: trade.seller.email,
      expiresAt: trade.expiresAt?.toISOString() ?? null,
      createdAt: trade.createdAt.toISOString(),
    };
  }

  /** Lista ostatnich trade'ów sprzedawcy (panel SkillGaming / integrator). */
  async listTradesForSeller(
    sellerId: string,
    options?: { limit?: number },
  ): Promise<{
    items: Array<{
      tradeId: string;
      itemName: string;
      status: TradeStatus;
      amountCents: string;
      createdAt: string;
      expiresAt: string | null;
    }>;
  }> {
    const rawLimit = options?.limit ?? 20;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(50, Math.max(1, Math.floor(rawLimit)))
      : 20;

    const trades = await this.prisma.trade.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        itemName: true,
        status: true,
        amountCents: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return {
      items: trades.map((t) => ({
        tradeId: t.id,
        itemName: t.itemName,
        status: t.status,
        amountCents: t.amountCents.toString(),
        createdAt: t.createdAt.toISOString(),
        expiresAt: t.expiresAt?.toISOString() ?? null,
      })),
    };
  }

  /** Kupujący wpłaca pełną kwotę — środki blokowane (escrow) do momentu potwierdzenia lub anulowania. */
  async payTrade(tradeId: string, buyerId: string): Promise<void> {
    const ref = `trade-escrow-${tradeId}-${randomUUID()}`;

    await this.prisma.$transaction(
      async (tx) => {
        const trade = await tx.trade.findUnique({ where: { id: tradeId } });
        if (trade === null) {
          throw new TradeNotFoundError();
        }
        if (trade.status === TradeStatus.PAID_AWAITING_ITEM && trade.buyerId === buyerId) {
          return;
        }
        if (trade.status === TradeStatus.PAID_AWAITING_ITEM && trade.buyerId !== buyerId) {
          throw new TradeInvalidStatusError("Trade already paid by another buyer");
        }
        if (trade.status !== TradeStatus.PENDING_PAYMENT) {
          throw new TradeInvalidStatusError("Trade is not awaiting payment");
        }
        if (trade.sellerId === buyerId) {
          throw new TradeInvalidStatusError("Cannot buy your own trade");
        }
        if (trade.expiresAt !== null && trade.expiresAt < new Date()) {
          throw new TradeExpiredError();
        }

        const buyerWallet = await tx.wallet.findUnique({
          where: { userId: buyerId },
          select: { id: true, balance: true },
        });
        if (buyerWallet === null) {
          throw new TradeInvalidStatusError("Buyer wallet not found");
        }
        if (buyerWallet.balance < trade.amountCents) {
          throw new TradeInsufficientFundsError();
        }

        try {
          await tx.wallet.update({
            where: { userId: buyerId },
            data: { balance: { decrement: trade.amountCents } },
          });
        } catch (err) {
          if (isInsufficientFundsDbError(err)) {
            throw new TradeInsufficientFundsError();
          }
          throw err;
        }

        await tx.transaction.create({
          data: {
            walletId: buyerWallet.id,
            amount: -trade.amountCents,
            referenceId: ref,
            type: TxType.TRADE_ESCROW_HOLD,
          },
        });

        await tx.trade.update({
          where: { id: tradeId },
          data: {
            buyerId,
            status: TradeStatus.PAID_AWAITING_ITEM,
            escrowReferenceId: ref,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );
  }

  /** Kupujący potwierdza odbiór — wypłata netto sprzedawcy + prowizja platformy. */
  async confirmReceipt(tradeId: string, buyerId: string): Promise<void> {
    const platformUserId = platformUserIdFromEnv();

    await this.prisma.$transaction(
      async (tx) => {
        const trade = await tx.trade.findUnique({ where: { id: tradeId } });
        if (trade === null) {
          throw new TradeNotFoundError();
        }
        if (trade.status === TradeStatus.COMPLETED) {
          return;
        }
        if (trade.status !== TradeStatus.PAID_AWAITING_ITEM) {
          throw new TradeInvalidStatusError("Trade is not awaiting confirmation");
        }
        if (trade.buyerId !== buyerId) {
          throw new TradeInvalidStatusError("Only the buyer can confirm receipt");
        }

        const sellerNet = trade.amountCents - trade.platformFeeCents;
        if (sellerNet < 0n) {
          throw new TradeInvalidStatusError("Invalid fee configuration for trade");
        }

        const [sellerWallet, platformWallet] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: trade.sellerId },
            select: { id: true },
          }),
          tx.wallet.findUnique({
            where: { userId: platformUserId },
            select: { id: true },
          }),
        ]);
        if (sellerWallet === null || platformWallet === null) {
          throw new TradeInvalidStatusError("Seller or platform wallet missing");
        }

        await tx.wallet.update({
          where: { id: sellerWallet.id },
          data: { balance: { increment: sellerNet } },
        });
        await tx.transaction.create({
          data: {
            walletId: sellerWallet.id,
            amount: sellerNet,
            referenceId: `trade:${tradeId}:seller`,
            type: TxType.TRADE_SELLER_CREDIT,
          },
        });

        if (trade.platformFeeCents > 0n) {
          await tx.wallet.update({
            where: { id: platformWallet.id },
            data: { balance: { increment: trade.platformFeeCents } },
          });
          await tx.transaction.create({
            data: {
              walletId: platformWallet.id,
              amount: trade.platformFeeCents,
              referenceId: `trade:${tradeId}:platform`,
              type: TxType.TRADE_PLATFORM_FEE,
            },
          });
        }

        await tx.trade.update({
          where: { id: tradeId },
          data: {
            status: TradeStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );
  }

  /**
   * Sprzedawca anuluje: przed płatnością — bez ruchu środkami; po wpłacie kupującego — pełny zwrot escrow.
   */
  async cancelBySeller(tradeId: string, sellerId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const trade = await tx.trade.findUnique({ where: { id: tradeId } });
        if (trade === null) {
          throw new TradeNotFoundError();
        }
        if (trade.sellerId !== sellerId) {
          throw new TradeInvalidStatusError("Only the seller can cancel this trade");
        }
        if (trade.status === TradeStatus.CANCELLED || trade.status === TradeStatus.COMPLETED) {
          throw new TradeInvalidStatusError("Trade already finalized");
        }
        if (trade.status === TradeStatus.DISPUTED) {
          throw new TradeInvalidStatusError("Trade is disputed");
        }

        if (trade.status === TradeStatus.PENDING_PAYMENT) {
          await tx.trade.update({
            where: { id: tradeId },
            data: { status: TradeStatus.CANCELLED },
          });
          return;
        }

        if (trade.status === TradeStatus.PAID_AWAITING_ITEM) {
          if (trade.buyerId === null) {
            throw new TradeInvalidStatusError("Trade has no buyer");
          }
          const buyerWallet = await tx.wallet.findUnique({
            where: { userId: trade.buyerId },
            select: { id: true },
          });
          if (buyerWallet === null) {
            throw new TradeInvalidStatusError("Buyer wallet not found");
          }

          await tx.wallet.update({
            where: { userId: trade.buyerId },
            data: { balance: { increment: trade.amountCents } },
          });
          await tx.transaction.create({
            data: {
              walletId: buyerWallet.id,
              amount: trade.amountCents,
              referenceId: `trade:${tradeId}:cancel-refund`,
              type: TxType.REFUND,
            },
          });

          await tx.trade.update({
            where: { id: tradeId },
            data: { status: TradeStatus.CANCELLED },
          });
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );
  }
}

export class TradeInsufficientFundsError extends Error {
  constructor() {
    super("Insufficient funds");
    this.name = "TradeInsufficientFundsError";
  }
}
