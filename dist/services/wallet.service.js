import { Prisma, TransactionType } from "@prisma/client";
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
export class WalletService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async depositFunds(userId, amount, referenceId) {
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
                    type: TransactionType.DEPOSIT,
                    walletId: wallet.id,
                },
            });
            return { transaction, created: true };
        });
    }
    async processEntryFee(userId, amount, referenceId) {
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
            let walletId;
            try {
                const updated = await tx.wallet.update({
                    where: { userId },
                    data: { balance: { decrement: amount } },
                    select: { id: true },
                });
                walletId = updated.id;
            }
            catch (err) {
                if (this.isInsufficientFundsDbError(err)) {
                    throw new InsufficientFundsError();
                }
                throw err;
            }
            return await tx.transaction.create({
                data: {
                    walletId,
                    amount: -amount,
                    referenceId,
                    type: TransactionType.FEE,
                },
            });
        });
    }
    isInsufficientFundsDbError(err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
            return false;
        }
        if (err.code === "P2025") {
            return true;
        }
        if (err.message.includes("wallet_balance_check")) {
            return true;
        }
        const meta = err.meta;
        if (meta?.constraint === "wallet_balance_check") {
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=wallet.service.js.map