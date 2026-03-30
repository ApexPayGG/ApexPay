import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { MatchSettlementService } from "./match-settlement.service.js";

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
    txMocks = createTxMock();
    const prismaTransaction = vi.fn(
      async (fn: (t: (typeof txMocks)["tx"]) => Promise<unknown>) =>
        fn(txMocks.tx),
    );
    prisma = { $transaction: prismaTransaction } as unknown as PrismaClient;
    settlement = new MatchSettlementService(prisma);
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
    settlement = new MatchSettlementService(prisma);

    await settlement.settleDisputedMatch({
      matchId: "m1",
      finalWinnerId: "w1",
    });

    expect(calls).toBe(2);
  });
});
