import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { MatchSettlementService } from "./match-settlement.service.js";
import type { TournamentBracketService } from "./tournament-bracket.service.js";

const bracketHoist = vi.hoisted(() => ({
  advanceAfterTerminalMatch: vi.fn().mockResolvedValue({
    tournamentCompleted: false,
    createdNextRoundMatches: 0,
  }),
}));

function createTxMock(overrides: {
  matchRow?: {
    id: string;
    status: string;
    winnerId: string | null;
    tournamentId: string;
  };
} = {}) {
  const matchRow = overrides.matchRow ?? {
    id: "m1",
    status: "DISPUTED",
    winnerId: null,
    tournamentId: "t1",
  };
  const queryRaw = vi.fn().mockResolvedValue([matchRow]);
  const matchFindUnique = vi.fn();
  const matchUpdate = vi.fn().mockResolvedValue({});
  const walletFindUnique = vi.fn();
  const walletUpdate = vi.fn();
  const transactionCreate = vi.fn();
  const userBalanceLedgerCreate = vi.fn();
  const outboxCreate = vi.fn();

  const tx = {
    $queryRaw: queryRaw,
    match: { findUnique: matchFindUnique, update: matchUpdate },
    wallet: { findUnique: walletFindUnique, update: walletUpdate },
    transaction: { create: transactionCreate },
    userBalanceLedger: { create: userBalanceLedgerCreate },
    outboxEvent: { create: outboxCreate },
  };
  return {
    tx,
    queryRaw,
    matchFindUnique,
    matchUpdate,
    walletFindUnique,
    walletUpdate,
    transactionCreate,
    userBalanceLedgerCreate,
    outboxCreate,
  };
}

describe("MatchSettlementService", () => {
  let prisma: PrismaClient;
  let settlement: MatchSettlementService;
  let txMocks: ReturnType<typeof createTxMock>;

  beforeEach(() => {
    bracketHoist.advanceAfterTerminalMatch.mockClear();
    txMocks = createTxMock();
    const prismaTransaction = vi.fn(
      async (fn: (t: (typeof txMocks)["tx"]) => Promise<unknown>) =>
        fn(txMocks.tx),
    );
    prisma = { $transaction: prismaTransaction } as unknown as PrismaClient;
    settlement = new MatchSettlementService(
      prisma,
      {
        advanceAfterTerminalMatch: bracketHoist.advanceAfterTerminalMatch,
      } as unknown as TournamentBracketService,
    );
  });

  it("throws MATCH_ALREADY_SETTLED when row is SETTLED", async () => {
    txMocks = createTxMock({
      matchRow: {
        id: "m1",
        status: "SETTLED",
        winnerId: "w1",
        tournamentId: "t1",
      },
    });
    (prisma as unknown as { $transaction: typeof vi.fn }).$transaction = vi.fn(
      async (fn: (t: (typeof txMocks)["tx"]) => Promise<unknown>) =>
        fn(txMocks.tx),
    );

    await expect(
      settlement.settleDisputedMatch({
        matchId: "m1",
        finalWinnerId: "w1",
      }),
    ).rejects.toMatchObject({ code: "MATCH_ALREADY_SETTLED" });
  });

  it("throws MATCH_NOT_DISPUTED when status is not DISPUTED", async () => {
    txMocks = createTxMock({
      matchRow: {
        id: "m1",
        status: "PENDING",
        winnerId: null,
        tournamentId: "t1",
      },
    });
    (prisma as unknown as { $transaction: typeof vi.fn }).$transaction = vi.fn(
      async (fn: (t: (typeof txMocks)["tx"]) => Promise<unknown>) =>
        fn(txMocks.tx),
    );

    await expect(
      settlement.settleDisputedMatch({
        matchId: "m1",
        finalWinnerId: "w1",
      }),
    ).rejects.toMatchObject({ code: "MATCH_NOT_DISPUTED" });
  });

  it("locks match, updates wallets, ledger, outbox, and sets SETTLED", async () => {
    txMocks = createTxMock();
    (prisma as unknown as { $transaction: typeof vi.fn }).$transaction = vi.fn(
      async (fn: (t: (typeof txMocks)["tx"]) => Promise<unknown>) =>
        fn(txMocks.tx),
    );

    txMocks.walletFindUnique.mockResolvedValue({ id: "wal-w", userId: "w1" });
    txMocks.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "DISPUTED",
      awardsTournamentPrize: true,
      tournament: {
        entryFee: 100n,
        participants: [{ userId: "a" }, { userId: "b" }],
        organizer: {
          id: "org1",
          wallet: { id: "wal-o", userId: "org1" },
        },
      },
    });

    const result = await settlement.settleDisputedMatch({
      matchId: "m1",
      finalWinnerId: "w1",
    });

    expect(bracketHoist.advanceAfterTerminalMatch).toHaveBeenCalledWith(
      "t1",
      txMocks.tx,
    );
    expect(txMocks.queryRaw).toHaveBeenCalled();
    expect(txMocks.walletUpdate).toHaveBeenCalled();
    expect(txMocks.userBalanceLedgerCreate).toHaveBeenCalled();
    expect(txMocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "FUNDS_SETTLED",
      }) as Record<string, unknown>,
    });
    expect(txMocks.matchUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "SETTLED", winnerId: "w1" },
    });
    expect(result.matchId).toBe("m1");
    expect(result.status).toBe("SETTLED");
    expect(result.prizePaid).toBe(true);
  });

  it("skips wallet payout when awardsTournamentPrize is false but still settles and advances bracket", async () => {
    txMocks = createTxMock();
    (prisma as unknown as { $transaction: typeof vi.fn }).$transaction = vi.fn(
      async (fn: (t: (typeof txMocks)["tx"]) => Promise<unknown>) =>
        fn(txMocks.tx),
    );

    txMocks.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "DISPUTED",
      awardsTournamentPrize: false,
      tournament: {
        entryFee: 100n,
        participants: [{ userId: "a" }, { userId: "b" }],
        organizer: {
          id: "org1",
          wallet: { id: "wal-o", userId: "org1" },
        },
      },
    });

    const result = await settlement.settleDisputedMatch({
      matchId: "m1",
      finalWinnerId: "w1",
    });

    expect(txMocks.walletFindUnique).not.toHaveBeenCalled();
    expect(txMocks.walletUpdate).not.toHaveBeenCalled();
    expect(txMocks.outboxCreate).not.toHaveBeenCalled();
    expect(result.prizePaid).toBe(false);
    expect(bracketHoist.advanceAfterTerminalMatch).toHaveBeenCalled();
  });

  it("retries on P2034 deadlock code", async () => {
    let calls = 0;
    const prismaTransaction = vi.fn(
      async (fn: (t: ReturnType<typeof createTxMock>["tx"]) => Promise<unknown>) => {
        calls += 1;
        if (calls === 1) {
          throw new Prisma.PrismaClientKnownRequestError("deadlock", {
            code: "P2034",
            clientVersion: "test",
          });
        }
        txMocks = createTxMock();
        txMocks.walletFindUnique.mockResolvedValue({ id: "wal-w", userId: "w1" });
        txMocks.matchFindUnique.mockResolvedValue({
          id: "m1",
          tournamentId: "t1",
          status: "DISPUTED",
          awardsTournamentPrize: true,
          tournament: {
            entryFee: 100n,
            participants: [{ userId: "a" }, { userId: "b" }],
            organizer: {
              id: "org1",
              wallet: { id: "wal-o", userId: "org1" },
            },
          },
        });
        return fn(txMocks.tx);
      },
    );
    prisma = { $transaction: prismaTransaction } as unknown as PrismaClient;
    settlement = new MatchSettlementService(
      prisma,
      {
        advanceAfterTerminalMatch: bracketHoist.advanceAfterTerminalMatch,
      } as unknown as TournamentBracketService,
    );

    await settlement.settleDisputedMatch({
      matchId: "m1",
      finalWinnerId: "w1",
    });

    expect(calls).toBe(2);
  });
});
