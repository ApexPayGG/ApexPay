import { TradeStatus, TransactionType as TxType, type Prisma } from "@prisma/client";
import { TradeInvalidStatusError } from "../services/trade.errors.js";

type EscrowTrade = {
  id: string;
  buyerId: string | null;
  amountCents: bigint;
};

/** Credits buyer wallet and marks trade CANCELLED inside an open transaction. */
export async function refundEscrowAndCancel(
  tx: Prisma.TransactionClient,
  trade: EscrowTrade,
): Promise<void> {
  if (trade.buyerId === null) {
    throw new TradeInvalidStatusError("Trade has no buyer");
  }
  const buyerWallet = await tx.wallet.findUnique({
    where: { userId: trade.buyerId },
    select: { id: true },
  });
  if (buyerWallet === null) {
    throw new TradeInvalidStatusError("Buyer wallet not found");
  }

  await tx.wallet.update({
    where: { userId: trade.buyerId },
    data: { balance: { increment: trade.amountCents } },
  });
  await tx.transaction.create({
    data: {
      walletId: buyerWallet.id,
      amount: trade.amountCents,
      referenceId: `trade:${trade.id}:cancel-refund`,
      type: TxType.REFUND,
    },
  });

  await tx.trade.update({
    where: { id: trade.id },
    data: { status: TradeStatus.CANCELLED },
  });
}
