import type { PrismaClient, Transaction, TransactionType } from "@prisma/client";
export declare class InsufficientFundsError extends Error {
    constructor();
}
/** Zarezerwowane na przyszłe przypadki (np. jawny konflikt); `processEntryFee` jest idempotentny po `referenceId`. */
export declare class DuplicateTransactionError extends Error {
    constructor();
}
export declare class WalletNotFoundError extends Error {
    constructor();
}
export declare class TransferSelfError extends Error {
    constructor();
}
export type AdminTransactionRow = {
    id: string;
    amount: string;
    referenceId: string;
    type: TransactionType;
    createdAt: Date;
    walletUserId: string;
};
export declare class WalletService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    getWalletForUser(userId: string): Promise<{
        id: string;
        balance: bigint;
        updatedAt: Date;
    } | null>;
    /**
     * Zasilenie salda (tylko wywołania z warstwy admin). Atomowy `increment` — bezpiecznie przy równoległych operacjach.
     */
    fundWalletAtomic(targetUserId: string, amount: bigint): Promise<{
        balance: bigint;
    }>;
    /**
     * Przelew P2P: atomowy zapis (WITHDRAWAL u nadawcy, DEPOSIT u odbiorcy).
     * Idempotentnie po `referenceId` (para `p2p:{ref}:out` / `:in`).
     */
    transferP2P(fromUserId: string, toUserId: string, amount: bigint, referenceId: string): Promise<{
        idempotent: boolean;
    }>;
    listTransactionsAdmin(skip: number, take: number): Promise<{
        items: AdminTransactionRow[];
        total: number;
    }>;
    depositFunds(userId: string, amount: bigint, referenceId: string): Promise<{
        transaction: Transaction;
        created: boolean;
    }>;
    processEntryFee(userId: string, amount: bigint, referenceId: string): Promise<Transaction>;
    private isInsufficientFundsDbError;
}
//# sourceMappingURL=wallet.service.d.ts.map