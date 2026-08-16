/**
 * Atomic user-funded debit. Production Wallet.balance has no CHECK >= 0,
 * so unguarded `decrement` can mint money by going negative.
 */
export async function debitWalletIfSufficient(
  tx: {
    wallet: {
      updateMany: (args: {
        where: { userId: string; balance: { gte: bigint } };
        data: { balance: { decrement: bigint } };
      }) => Promise<{ count: number }>;
    };
  },
  userId: string,
  amount: bigint,
): Promise<boolean> {
  const result = await tx.wallet.updateMany({
    where: { userId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  return result.count === 1;
}
