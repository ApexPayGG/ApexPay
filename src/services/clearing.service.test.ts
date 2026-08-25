import { describe, it, expect, vi } from "vitest";
import { TransactionType } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ClearingService } from "./clearing.service.js";

function prizeMatch() {
  return {
    id: "m1",
    awardsTournamentPrize: true,
    tournament: {
      entryFee: 1000n,
      participants: [{ id: "p1" }, { id: "p2" }],
      organizer: { wallet: { id: "org-w" } },
    },
  };
}

describe("ClearingService.processPayout", () => {
  it("does not mint a second prize when v1 already wrote payout_win_v1_{matchId}", async () => {
    const walletUpdate = vi.fn();
    const transactionCreate = vi.fn();
    const walletFindUnique = vi.fn();
    const transactionFindFirst = vi.fn().mockResolvedValue({
      id: "existing",
      referenceId: "payout_win_v1_m1",
    });
    const tx = {
      match: { findUnique: vi.fn().mockResolvedValue(prizeMatch()) },
      transaction: { findFirst: transactionFindFirst, create: transactionCreate },
      wallet: { findUnique: walletFindUnique, update: walletUpdate },
    } as unknown as Prisma.TransactionClient;

    const paid = await new ClearingService({} as PrismaClient).processPayout(
      "m1",
      "winner-1",
      tx,
    );

    expect(paid).toBe(true);
    expect(transactionFindFirst).toHaveBeenCalled();
    expect(walletFindUnique).not.toHaveBeenCalled();
    expect(walletUpdate).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it("uses a stable prize referenceId so retries cannot insert a second ledger row", async () => {
    const walletUpdate = vi.fn().mockResolvedValue({});
    const transactionCreate = vi.fn().mockResolvedValue({});
    const tx = {
      match: { findUnique: vi.fn().mockResolvedValue(prizeMatch()) },
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: transactionCreate,
      },
      wallet: {
        findUnique: vi.fn().mockResolvedValue({ id: "win-w" }),
        update: walletUpdate,
      },
    } as unknown as Prisma.TransactionClient;

    await new ClearingService({} as PrismaClient).processPayout(
      "m1",
      "winner-1",
      tx,
    );

    expect(transactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 1800n,
        referenceId: "payout_win_m1",
        type: TransactionType.PRIZE_PAYOUT,
        walletId: "win-w",
      }),
    });
    expect(transactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 100n,
        referenceId: "payout_org_m1",
        type: TransactionType.PRIZE_PAYOUT,
        walletId: "org-w",
      }),
    });
  });
});
