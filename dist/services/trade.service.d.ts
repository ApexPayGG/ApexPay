import { TradeStatus, type PrismaClient } from "@prisma/client";
export declare class TradeNotFoundError extends Error {
    constructor();
}
export declare class TradeInvalidStatusError extends Error {
    constructor(msg?: string);
}
export declare class TradeExpiredError extends Error {
    constructor();
}
export declare class TradePlatformConfigError extends Error {
    constructor(message: string);
}
export declare class TradeService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    createTrade(sellerId: string, input: {
        itemName: string;
        description?: string;
        amountCents: number;
        expiresInHours?: number;
    }): Promise<{
        tradeId: string;
        tradeLink: string;
    }>;
    getTrade(tradeId: string): Promise<{
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
    }>;
    /** Lista ostatnich trade'ów sprzedawcy (panel SkillGaming / integrator). */
    listTradesForSeller(sellerId: string, options?: {
        limit?: number;
    }): Promise<{
        items: Array<{
            tradeId: string;
            itemName: string;
            status: TradeStatus;
            amountCents: string;
            createdAt: string;
            expiresAt: string | null;
        }>;
    }>;
    /** Kupujący wpłaca pełną kwotę — środki blokowane (escrow) do momentu potwierdzenia lub anulowania. */
    payTrade(tradeId: string, buyerId: string): Promise<void>;
    /** Kupujący potwierdza odbiór — wypłata netto sprzedawcy + prowizja platformy. */
    confirmReceipt(tradeId: string, buyerId: string): Promise<void>;
    /**
     * Sprzedawca anuluje: przed płatnością — bez ruchu środkami; po wpłacie kupującego — pełny zwrot escrow.
     */
    cancelBySeller(tradeId: string, sellerId: string): Promise<void>;
}
export declare class TradeInsufficientFundsError extends Error {
    constructor();
}
//# sourceMappingURL=trade.service.d.ts.map