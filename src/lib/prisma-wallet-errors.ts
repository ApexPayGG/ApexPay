import { Prisma } from "@prisma/client";

/** Czy błąd Prisma oznacza niewystarczające środki (constraint salda / brak wiersza po update). */
export function isInsufficientFundsDbError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (err.code === "P2025") {
    return true;
  }
  const meta = err.meta as { constraint?: string } | undefined;
  if (meta?.constraint === "wallet_balance_check") {
    return true;
  }
  return err.message.includes("wallet_balance_check");
}
