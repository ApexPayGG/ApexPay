import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { ClearingService } from "./clearing.service.js";

describe("ClearingService.processPayout", () => {
  const matchFindUnique = vi.fn();
  const walletFindUnique = vi.fn();
  const walletUpdate = vi.fn();
  const transactionCreate = vi.fn();

  const tx = {
    match: { findUnique: matchFindUnique },
    wallet: { findUnique: walletFindUnique, update: walletUpdate },
    transaction: { create: transactionCreate },
  } as unknown as Prisma.TransactionClient;

  let service: ClearingService;

  beforeEach(() => {
    matchFindUnique.mockReset();
    walletFindUnique.mockReset();
    walletUpdate.mockReset();
    transactionCreate.mockReset();
    service = new ClearingService({} as never);
  });

  it("credits winner when tournament is IN_PROGRESS and awardsTournamentPrize", async () => {
    matchFindUnique.mockResolvedValue({
      id: "m1",
      awardsTournamentPrize: true,
      tournament: {
        status: "IN_PROGRESS",
        entryFee: 100n,
        participants: [{ userId: "a" }, { userId: "b" }],
        organizer: { wallet: { id: "wal-o" } },
      },
    });
    walletFindUnique.mockResolvedValue({ id: "wal-w", userId: "w1" });
    walletUpdate.mockResolvedValue({});
    transactionCreate.mockResolvedValue({});

    const paid = await service.processPayout("m1", "w1", tx);

    expect(paid).toBe(true);
    expect(walletUpdate).toHaveBeenCalled();
  });

  it("throws TOURNAMENT_NOT_ACTIVE when tournament was canceled after refunds", async () => {
    matchFindUnique.mockResolvedValue({
      id: "m1",
      awardsTournamentPrize: true,
      tournament: {
        status: "CANCELED",
        entryFee: 100n,
        participants: [{ userId: "a" }, { userId: "b" }],
        organizer: { wallet: { id: "wal-o" } },
      },
    });

    await expect(service.processPayout("m1", "w1", tx)).rejects.toThrow(
      "TOURNAMENT_NOT_ACTIVE",
    );
    expect(walletUpdate).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it("throws TOURNAMENT_NOT_ACTIVE when tournament is COMPLETED", async () => {
    matchFindUnique.mockResolvedValue({
      id: "m1",
      awardsTournamentPrize: true,
      tournament: {
        status: "COMPLETED",
        entryFee: 100n,
        participants: [{ userId: "a" }, { userId: "b" }],
        organizer: { wallet: { id: "wal-o" } },
      },
    });

    await expect(service.processPayout("m1", "w1", tx)).rejects.toThrow(
      "TOURNAMENT_NOT_ACTIVE",
    );
    expect(walletUpdate).not.toHaveBeenCalled();
  });

  it("returns false without wallet writes when awardsTournamentPrize is false", async () => {
    matchFindUnique.mockResolvedValue({
      id: "m1",
      awardsTournamentPrize: false,
      tournament: {
        status: "IN_PROGRESS",
        entryFee: 100n,
        participants: [{ userId: "a" }, { userId: "b" }],
        organizer: { wallet: { id: "wal-o" } },
      },
    });

    const paid = await service.processPayout("m1", "w1", tx);
    expect(paid).toBe(false);
    expect(walletUpdate).not.toHaveBeenCalled();
  });
});
