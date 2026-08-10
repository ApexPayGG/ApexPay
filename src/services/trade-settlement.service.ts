import {
  Prisma,
  TradeStatus,
  TransactionType as TxType,
  type PrismaClient,
} from "@prisma/client";
import { refundEscrowAndCancel } from "../lib/trade-escrow-refund.js";
import {
  TradeInvalidStatusError,
  TradeNotFoundError,
  TradePlatformConfigError,
} from "./trade.errors.js";

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

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5000,
  timeout: 15000,
} as const;

/** Confirm / cancel paths that release or distribute trade escrow. */
export class TradeSettlementService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Kupujący potwierdza odbiór — wypłata netto sprzedawcy + prowizja platformy. */
  async confirmReceipt(tradeId: string, buyerId: string): Promise<void> {
    const platformUserId = platformUserIdFromEnv();

    await this.prisma.$transaction(async (tx) => {
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
    }, SERIALIZABLE);
  }

  /**
   * Sprzedawca anuluje: przed płatnością — bez ruchu środkami; po wpłacie kupującego — pełny zwrot escrow.
   */
  async cancelBySeller(tradeId: string, sellerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
        await refundEscrowAndCancel(tx, trade);
      }
    }, SERIALIZABLE);
  }

  /**
   * Kupujący odzyskuje escrow po wygaśnięciu okna dostawy (expiresAt ustawiane przy payTrade).
   * Bez tej ścieżki niesforny sprzedawca mógłby trwale zamrozić środki kupującego.
   */
  async cancelByBuyer(tradeId: string, buyerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const trade = await tx.trade.findUnique({ where: { id: tradeId } });
      if (trade === null) {
        throw new TradeNotFoundError();
      }
      if (trade.status === TradeStatus.CANCELLED || trade.status === TradeStatus.COMPLETED) {
        throw new TradeInvalidStatusError("Trade already finalized");
      }
      if (trade.status !== TradeStatus.PAID_AWAITING_ITEM) {
        throw new TradeInvalidStatusError("Trade is not awaiting item delivery");
      }
      if (trade.buyerId !== buyerId) {
        throw new TradeInvalidStatusError("Only the buyer can reclaim this escrow");
      }
      if (trade.expiresAt !== null && trade.expiresAt >= new Date()) {
        throw new TradeInvalidStatusError("Escrow reclaim window has not elapsed");
      }

      await refundEscrowAndCancel(tx, trade);
    }, SERIALIZABLE);
  }
}
