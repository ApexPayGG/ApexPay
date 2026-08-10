import { randomUUID } from "node:crypto";
import {
  Prisma,
  TradeStatus,
  TransactionType as TxType,
  type PrismaClient,
} from "@prisma/client";
import { isInsufficientFundsDbError } from "../lib/prisma-wallet-errors.js";
import {
  TradeExpiredError,
  TradeInsufficientFundsError,
  TradeInvalidStatusError,
  TradeNotFoundError,
} from "./trade.errors.js";
import { TradeSettlementService } from "./trade-settlement.service.js";

export {
  TradeExpiredError,
  TradeInsufficientFundsError,
  TradeInvalidStatusError,
  TradeNotFoundError,
  TradePlatformConfigError,
} from "./trade.errors.js";

const PLATFORM_FEE_PERCENT = 3;
/** After payTrade, buyer may reclaim escrow only once this window elapses. */
const ESCROW_HOLD_MS = 72 * 3600 * 1000;

export class TradeService {
  private readonly settlement: TradeSettlementService;

  constructor(private readonly prisma: PrismaClient) {
    this.settlement = new TradeSettlementService(prisma);
  }

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
            // Offer expiry must not strand paid escrow — reset a delivery window from payment.
            expiresAt: new Date(Date.now() + ESCROW_HOLD_MS),
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

  async confirmReceipt(tradeId: string, buyerId: string): Promise<void> {
    return this.settlement.confirmReceipt(tradeId, buyerId);
  }

  async cancelBySeller(tradeId: string, sellerId: string): Promise<void> {
    return this.settlement.cancelBySeller(tradeId, sellerId);
  }

  async cancelByBuyer(tradeId: string, buyerId: string): Promise<void> {
    return this.settlement.cancelByBuyer(tradeId, buyerId);
  }
}
