import type { PrismaClient, Transaction } from "@prisma/client";
export declare class InsufficientFundsError extends Error {
    constructor();
}
/** Zarezerwowane na przyszłe przypadki (np. jawny konflikt); `processEntryFee` jest idempotentny po `referenceId`. */
export declare class DuplicateTransactionError extends Error {
    constructor();
}
export declare class WalletService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    depositFunds(userId: string, amount: bigint, referenceId: string): Promise<{
        transaction: Transaction;
        created: boolean;
    }>;
    processEntryFee(userId: string, amount: bigint, referenceId: string): Promise<Transaction>;
    private isInsufficientFundsDbError;
}
//# sourceMappingURL=wallet.service.d.ts.map