import type { Prisma } from "@prisma/client";

type WalletDebitClient = {
  wallet: Pick<Prisma.TransactionClient["wallet"], "updateMany">;
};

export async function debitWalletByUserIdIfFunded(
  tx: WalletDebitClient,
  userId: string,
  amount: bigint,
): Promise<boolean> {
  const result = await tx.wallet.updateMany({
    where: { userId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  return result.count === 1;
}

export async function debitWalletByIdIfFunded(
  tx: WalletDebitClient,
  walletId: string,
  amount: bigint,
): Promise<boolean> {
  const result = await tx.wallet.updateMany({
    where: { id: walletId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  return result.count === 1;
}
