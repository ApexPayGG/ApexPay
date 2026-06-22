import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/apexpay_test";

  const tournamentFindUnique = vi.fn();
  const tournamentParticipantFindUnique = vi.fn();
  const tournamentParticipantCreate = vi.fn();
  const walletFindUnique = vi.fn();
  const walletUpdateMany = vi.fn();
  const ledgerCreate = vi.fn();

  const mockTx = {
    tournament: { findUnique: tournamentFindUnique },
    tournamentParticipant: {
      findUnique: tournamentParticipantFindUnique,
      create: tournamentParticipantCreate,
    },
    wallet: { findUnique: walletFindUnique, updateMany: walletUpdateMany },
    transaction: { create: ledgerCreate },
  };

  const prismaTransaction = vi.fn(
    async (fn: (t: typeof mockTx) => Promise<unknown>, _opts?: unknown) =>
      fn(mockTx),
  );

  return {
    tournamentFindUnique,
    tournamentParticipantFindUnique,
    tournamentParticipantCreate,
    walletFindUnique,
    walletUpdateMany,
    ledgerCreate,
    prismaTransaction,
  };
});

vi.mock("pg", () => {
  class Pool {
    constructor(_opts: unknown) {}
  }
  return { default: { Pool } };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(_pool: unknown) {}
  },
}));

vi.mock("@prisma/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@prisma/client")>();
  class MockPrismaClient {
    $transaction = h.prismaTransaction;
  }
  return { ...mod, PrismaClient: MockPrismaClient };
});

import { TournamentController } from "./tournament.controller.js";

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.prismaTransaction.mockImplementation(async (fn) =>
    fn({
      tournament: { findUnique: h.tournamentFindUnique },
      tournamentParticipant: {
        findUnique: h.tournamentParticipantFindUnique,
        create: h.tournamentParticipantCreate,
      },
      wallet: { findUnique: h.walletFindUnique, updateMany: h.walletUpdateMany },
      transaction: { create: h.ledgerCreate },
    }),
  );
});

describe("TournamentController.joinTournament wallet debit guard", () => {
  it("returns 402 and does not create escrow when guarded debit finds insufficient funds", async () => {
    h.tournamentFindUnique.mockResolvedValue({
      id: "t1",
      status: "REGISTRATION",
      registrationEndsAt: new Date(Date.now() + 60_000),
      maxPlayers: 8,
      entryFee: 500n,
      _count: { participants: 0 },
    });
    h.tournamentParticipantFindUnique.mockResolvedValue(null);
    h.walletFindUnique.mockResolvedValue({ id: "wallet_1" });
    h.walletUpdateMany.mockResolvedValue({ count: 0 });

    const res = response();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await new TournamentController().joinTournament(
      { params: { id: "t1" }, user: { id: "player_1" } } as never,
      res as never,
    );

    expect(h.walletUpdateMany).toHaveBeenCalledWith({
      where: { userId: "player_1", balance: { gte: 500n } },
      data: { balance: { decrement: 500n } },
    });
    expect(h.ledgerCreate).not.toHaveBeenCalled();
    expect(h.tournamentParticipantCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);

    errSpy.mockRestore();
  });
});
