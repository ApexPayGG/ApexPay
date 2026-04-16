import { Prisma } from "@prisma/client";
/** Czy błąd Prisma oznacza niewystarczające środki (constraint salda / brak wiersza po update). */
export function isInsufficientFundsDbError(err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
        return false;
    }
    if (err.code === "P2025") {
        return true;
    }
    const meta = err.meta;
    if (meta?.constraint === "wallet_balance_check") {
        return true;
    }
    return err.message.includes("wallet_balance_check");
}
//# sourceMappingURL=prisma-wallet-errors.js.map