import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/apexpay_test";
  const tournamentCreate = vi.fn();
  const tournamentFindUnique = vi.fn();
  const tournamentUpdate = vi.fn();
  const tournamentParticipantFindUnique = vi.fn();
  const tournamentParticipantCreate = vi.fn();
  const walletFindUnique = vi.fn();
  const walletUpdate = vi.fn();
  const ledgerCreate = vi.fn();
  const matchCreateMany = vi.fn();
  const matchFindMany = vi.fn();
  const tournamentReadFindUnique = vi.fn();
  const tournamentListFindMany = vi.fn();
  const mockTx = {
    tournament: { findUnique: tournamentFindUnique, update: tournamentUpdate },
    tournamentParticipant: {
      findUnique: tournamentParticipantFindUnique,
      create: tournamentParticipantCreate,
    },
    match: { createMany: matchCreateMany, findMany: matchFindMany },
    wallet: { findUnique: walletFindUnique, update: walletUpdate },
    transaction: { create: ledgerCreate },
  };
  const prismaTransaction = vi.fn(
    async (fn: (t: typeof mockTx) => Promise<unknown>, _opts?: unknown) =>
      fn(mockTx),
  );
  return {
    tournamentCreate,
    tournamentFindUnique,
    tournamentUpdate,
    tournamentParticipantFindUnique,
    tournamentParticipantCreate,
    walletFindUnique,
    walletUpdate,
    ledgerCreate,
    matchCreateMany,
    matchFindMany,
    tournamentReadFindUnique,
    tournamentListFindMany,
    mockTx,
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
    tournament = {
      create: h.tournamentCreate,
      findUnique: h.tournamentReadFindUnique,
      findMany: h.tournamentListFindMany,
    };
    $transaction = h.prismaTransaction;
  }
  return { ...mod, PrismaClient: MockPrismaClient };
});

import { TournamentController } from "./tournament.controller.js";

type MockRequest = {
  body: Record<string, unknown>;
  user?: { id: string };
  params?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
};

function createMockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

function baseBody() {
  return {
    title: "Cup",
    entryFeeCents: "600",
    maxPlayers: 8,
    registrationEndsInHours: 24,
  };
}

function resetJoinMocks() {
  h.tournamentFindUnique.mockReset();
  h.tournamentUpdate.mockReset();
  h.tournamentParticipantFindUnique.mockReset();
  h.tournamentParticipantCreate.mockReset();
  h.matchCreateMany.mockReset();
  h.matchFindMany.mockReset();
  h.walletFindUnique.mockReset();
  h.walletUpdate.mockReset();
  h.ledgerCreate.mockReset();
  h.prismaTransaction.mockReset();
  h.prismaTransaction.mockImplementation(async (fn) => fn(h.mockTx));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tournamentCreate.mockReset();
  h.tournamentReadFindUnique.mockReset();
  h.tournamentListFindMany.mockReset();
  resetJoinMocks();
});

describe("TournamentController.createTournament", () => {
  it("returns 401 when organizer id is missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.createTournament(
      { body: baseBody() } as MockRequest as never,
      res as never,
    );

    expect(h.tournamentCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when a required field is missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    const body = { ...baseBody(), maxPlayers: undefined };

    await controller.createTournament(
      { body, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );

    expect(h.tournamentCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Brakuje kluczowych parametrów turnieju." }),
    );
  });

  it("returns 400 when entry fee is below minimum (MVF)", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.createTournament(
      {
        body: { ...baseBody(), entryFeeCents: "499" },
        user: { id: "u1" },
      } as MockRequest as never,
      res as never,
    );

    expect(h.tournamentCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Biznesowa blokada" }),
    );
  });

  it("returns 400 when maxPlayers is outside 2..1000", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.createTournament(
      {
        body: { ...baseBody(), maxPlayers: 1 },
        user: { id: "u1" },
      } as MockRequest as never,
      res as never,
    );

    expect(h.tournamentCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 201 with ApexPay payload on success", async () => {
    const deadline = new Date("2026-06-01T12:00:00.000Z");
    h.tournamentCreate.mockResolvedValue({
      id: "tmt_1",
      entryFee: 600n,
      maxPlayers: 8,
      registrationEndsAt: deadline,
    });

    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.createTournament(
      { body: baseBody(), user: { id: "org_1" } } as MockRequest as never,
      res as never,
    );

    expect(h.tournamentCreate).toHaveBeenCalledTimes(1);
    const call = h.tournamentCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.title).toBe("Cup");
    expect(call.data.entryFee).toBe(600n);
    expect(call.data.maxPlayers).toBe(8);
    expect(call.data.organizerId).toBe("org_1");
    expect(call.data.status).toBe("REGISTRATION");
    expect(call.data.registrationEndsAt).toBeInstanceOf(Date);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload?.status).toBe("success");
    const data = payload?.data as Record<string, unknown>;
    expect(data?.tournamentId).toBe("tmt_1");
    expect(data?.entryFeeCents).toBe("600");
    expect(data?.maxPlayers).toBe(8);
    expect(data?.deadline).toBe(deadline);
    expect(data?.joinLink).toBe("https://apexpay.io/pay/tmt_1");
  });

  it("returns 500 when prisma.create rejects", async () => {
    h.tournamentCreate.mockRejectedValue(new Error("db down"));

    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await controller.createTournament(
      { body: baseBody(), user: { id: "u1" } } as MockRequest as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    errSpy.mockRestore();
  });
});

describe("TournamentController.joinTournament", () => {
  function openTournament(participantCount: number) {
    return {
      id: "t1",
      status: "REGISTRATION" as const,
      registrationEndsAt: new Date(Date.now() + 86_400_000),
      maxPlayers: 10,
      entryFee: 500n,
      _count: { participants: participantCount },
    };
  }

  it("returns 401 when user id is missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.joinTournament(
      { params: { id: "t1" } } as MockRequest as never,
      res as never,
    );

    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when tournament id is missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.joinTournament(
      { params: { id: "" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );

    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when tournament does not exist", async () => {
    h.tournamentFindUnique.mockResolvedValue(null);

    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await controller.joinTournament(
      { params: { id: "missing" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    errSpy.mockRestore();
  });

  it("returns 200 and ticketId on successful join", async () => {
    h.tournamentFindUnique.mockResolvedValue(openTournament(3));
    h.tournamentParticipantFindUnique.mockResolvedValue(null);
    h.walletFindUnique.mockResolvedValue({ id: "w1" });
    h.walletUpdate.mockResolvedValue({ id: "w1", balance: 0n });
    h.ledgerCreate.mockResolvedValue({ id: "tx1" });
    h.tournamentParticipantCreate.mockResolvedValue({ id: "ticket-xyz" });

    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.joinTournament(
      { params: { id: "t1" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );

    expect(h.prismaTransaction).toHaveBeenCalledTimes(1);
    expect(h.walletUpdate).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { balance: { decrement: 500n } },
    });
    expect(h.ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 500n,
          type: "ESCROW_HOLD",
          walletId: "w1",
        }) as Record<string, unknown>,
      }),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload?.status).toBe("success");
    const data = payload?.data as Record<string, unknown>;
    expect(data?.ticketId).toBe("ticket-xyz");
  });

  it("returns 409 when tournament is full", async () => {
    h.tournamentFindUnique.mockResolvedValue(openTournament(10));

    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await controller.joinTournament(
      { params: { id: "t1" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });
});

describe("TournamentController.startTournament", () => {
  function startableTournament(
    participantCount: number,
    opts?: { odd?: boolean; matches?: { id: string }[] },
  ) {
    const n = opts?.odd === true ? participantCount + 1 : participantCount;
    const participants = Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      joinedAt: new Date(`2026-01-0${1 + (i % 9)}T12:00:00.000Z`),
    }));
    return {
      id: "t-start",
      organizerId: "org1",
      status: "REGISTRATION" as const,
      participants,
      matches: opts?.matches ?? [],
    };
  }

  it("returns 401 when user id is missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.startTournament(
      { params: { id: "t-start" } } as MockRequest as never,
      res as never,
    );
    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when tournament id is missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.startTournament(
      { params: { id: "" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );
    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when tournament does not exist", async () => {
    h.tournamentFindUnique.mockResolvedValue(null);
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await controller.startTournament(
      { params: { id: "missing" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    errSpy.mockRestore();
  });

  it("returns 403 when caller is not organizer", async () => {
    h.tournamentFindUnique.mockResolvedValue(startableTournament(2));
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await controller.startTournament(
      { params: { id: "t-start" }, user: { id: "other" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    errSpy.mockRestore();
  });

  it("returns 409 when status is not REGISTRATION", async () => {
    h.tournamentFindUnique.mockResolvedValue({
      ...startableTournament(2),
      status: "IN_PROGRESS" as const,
    });
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await controller.startTournament(
      { params: { id: "t-start" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });

  it("returns 409 when tournament already has matches", async () => {
    h.tournamentFindUnique.mockResolvedValue({
      ...startableTournament(2),
      matches: [{ id: "m-old" }],
    });
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await controller.startTournament(
      { params: { id: "t-start" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });

  it("returns 400 when fewer than 2 participants", async () => {
    h.tournamentFindUnique.mockResolvedValue(startableTournament(1));
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await controller.startTournament(
      { params: { id: "t-start" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    errSpy.mockRestore();
  });

  it("returns 400 when participant count is odd", async () => {
    h.tournamentFindUnique.mockResolvedValue(startableTournament(2, { odd: true }));
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await controller.startTournament(
      { params: { id: "t-start" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    errSpy.mockRestore();
  });

  it("returns 200, creates N/2 matches and sets IN_PROGRESS", async () => {
    h.tournamentFindUnique.mockResolvedValue(startableTournament(4));
    h.matchCreateMany.mockResolvedValue({ count: 2 });
    h.matchFindMany.mockResolvedValue([
      { id: "m1", playerAId: "u0", playerBId: "u1" },
      { id: "m2", playerAId: "u2", playerBId: "u3" },
    ]);

    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.startTournament(
      { params: { id: "t-start" }, user: { id: "org1" } } as MockRequest as never,
      res as never,
    );

    expect(h.matchCreateMany).toHaveBeenCalledWith({
      data: [
        {
          tournamentId: "t-start",
          status: "PENDING",
          playerAId: "u0",
          playerBId: "u1",
          roundNumber: 1,
          awardsTournamentPrize: false,
        },
        {
          tournamentId: "t-start",
          status: "PENDING",
          playerAId: "u2",
          playerBId: "u3",
          roundNumber: 1,
          awardsTournamentPrize: false,
        },
      ],
    });

    expect(h.tournamentUpdate).toHaveBeenCalledWith({
      where: { id: "t-start" },
      data: { status: "IN_PROGRESS" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload?.status).toBe("success");
    const data = payload?.data as Record<string, unknown>;
    expect(data?.tournamentId).toBe("t-start");
    expect(data?.matchIds).toEqual(["m1", "m2"]);
    expect(data?.round1Matches).toBe(2);
    expect(data?.round1).toEqual([
      { matchId: "m1", playerAId: "u0", playerBId: "u1" },
      { matchId: "m2", playerAId: "u2", playerBId: "u3" },
    ]);
  });
});

describe("TournamentController.cancelAndRefund", () => {
  function cancellableTournament(organizerId: string) {
    return {
      id: "tn1",
      organizerId,
      status: "REGISTRATION" as const,
      entryFee: 300n,
      participants: [
        {
          userId: "p1",
          user: { wallet: { id: "w-p1" } },
        },
      ],
    };
  }

  it("returns 401 without user", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.cancelAndRefund(
      { params: { id: "tn1" } } as MockRequest as never,
      res as never,
    );
    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when tournament id missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.cancelAndRefund(
      { params: { id: "" }, user: { id: "org" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when tournament not found", async () => {
    h.tournamentFindUnique.mockResolvedValue(null);
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await controller.cancelAndRefund(
      { params: { id: "tn1" }, user: { id: "org" } } as MockRequest as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    errSpy.mockRestore();
  });

  it("returns 403 when caller is not organizer", async () => {
    h.tournamentFindUnique.mockResolvedValue(cancellableTournament("real-org"));
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await controller.cancelAndRefund(
      { params: { id: "tn1" }, user: { id: "intruder" } } as MockRequest as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    errSpy.mockRestore();
  });

  it("returns 409 when tournament already completed or canceled", async () => {
    h.tournamentFindUnique.mockResolvedValue({
      ...cancellableTournament("org"),
      status: "COMPLETED",
    });
    const controller = new TournamentController();
    const res = createMockResponse();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await controller.cancelAndRefund(
      { params: { id: "tn1" }, user: { id: "org" } } as MockRequest as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });

  it("returns 200 and refunds participants", async () => {
    h.tournamentFindUnique.mockResolvedValue(cancellableTournament("org"));
    h.walletUpdate.mockResolvedValue({});
    h.ledgerCreate.mockResolvedValue({});
    h.tournamentUpdate.mockResolvedValue({});

    const controller = new TournamentController();
    const res = createMockResponse();

    await controller.cancelAndRefund(
      { params: { id: "tn1" }, user: { id: "org" } } as MockRequest as never,
      res as never,
    );

    expect(h.walletUpdate).toHaveBeenCalledWith({
      where: { id: "w-p1" },
      data: { balance: { increment: 300n } },
    });
    expect(h.ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 300n,
          type: "REFUND",
          walletId: "w-p1",
        }) as Record<string, unknown>,
      }),
    );
    expect(h.tournamentUpdate).toHaveBeenCalledWith({
      where: { id: "tn1" },
      data: { status: "CANCELED" },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("TournamentController.listTournaments", () => {
  it("returns 401 without user", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments({ query: {} } as MockRequest as never, res as never);
    expect(h.tournamentListFindMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when limit is invalid", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments(
      { user: { id: "u1" }, query: { limit: "99" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentListFindMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when status is invalid", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments(
      { user: { id: "u1" }, query: { status: "FOO" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentListFindMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 200 with items", async () => {
    const ends = new Date("2026-06-01T12:00:00.000Z");
    h.tournamentListFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Cup",
        status: "REGISTRATION",
        entryFee: 600n,
        maxPlayers: 8,
        registrationEndsAt: ends,
        minLevel: 1,
        organizerId: "org1",
        createdAt: ends,
        _count: { participants: 3 },
      },
    ]);
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments(
      {
        user: { id: "u1" },
        query: { limit: "10", status: "REGISTRATION" },
      } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentListFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "REGISTRATION" },
        take: 10,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    const data = payload?.data as { items: unknown[] };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      tournamentId: "t1",
      entryFeeCents: "600",
      participantCount: 3,
    });
  });
});

describe("TournamentController.getTournament", () => {
  it("returns 401 without user", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "t1" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentReadFindUnique).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when id missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentReadFindUnique).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when not found", async () => {
    h.tournamentReadFindUnique.mockResolvedValue(null);
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "x" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with matches and participants", async () => {
    const joined = new Date("2026-01-02T12:00:00.000Z");
    h.tournamentReadFindUnique.mockResolvedValue({
      id: "t1",
      title: "Cup",
      status: "IN_PROGRESS",
      entryFee: 500n,
      maxPlayers: 4,
      minLevel: 1,
      registrationEndsAt: joined,
      organizerId: "org1",
      createdAt: joined,
      participants: [{ userId: "u0", joinedAt: joined }],
      matches: [
        {
          id: "m1",
          roundNumber: 1,
          status: "PENDING",
          playerAId: "u0",
          playerBId: "u1",
          winnerId: null,
          awardsTournamentPrize: false,
          createdAt: joined,
        },
      ],
    });
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "t1" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const data = (res.json.mock.calls[0]?.[0] as Record<string, unknown>)
      ?.data as Record<string, unknown>;
    expect(data?.matches).toHaveLength(1);
    expect(data?.participants).toHaveLength(1);
    expect((data?.matches as unknown[])[0]).toMatchObject({
      matchId: "m1",
      roundNumber: 1,
    });
  });
});

describe("TournamentController.listTournaments", () => {
  it("returns 401 without user", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments({ query: {} } as MockRequest as never, res as never);
    expect(h.tournamentListFindMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when limit is invalid", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments(
      { user: { id: "u1" }, query: { limit: "99" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentListFindMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when status is invalid", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments(
      { user: { id: "u1" }, query: { status: "FOO" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentListFindMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 200 with items", async () => {
    const ends = new Date("2026-06-01T12:00:00.000Z");
    h.tournamentListFindMany.mockResolvedValue([
      {
        id: "t1",
        title: "Cup",
        status: "REGISTRATION",
        entryFee: 600n,
        maxPlayers: 8,
        registrationEndsAt: ends,
        minLevel: 1,
        organizerId: "org1",
        createdAt: ends,
        _count: { participants: 3 },
      },
    ]);
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.listTournaments(
      {
        user: { id: "u1" },
        query: { limit: "10", status: "REGISTRATION" },
      } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentListFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "REGISTRATION" },
        take: 10,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    const data = payload?.data as { items: unknown[] };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      tournamentId: "t1",
      entryFeeCents: "600",
      participantCount: 3,
    });
  });
});

describe("TournamentController.getTournament", () => {
  it("returns 401 without user", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "t1" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentReadFindUnique).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when id missing", async () => {
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );
    expect(h.tournamentReadFindUnique).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when not found", async () => {
    h.tournamentReadFindUnique.mockResolvedValue(null);
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "x" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with matches and participants", async () => {
    const joined = new Date("2026-01-02T12:00:00.000Z");
    h.tournamentReadFindUnique.mockResolvedValue({
      id: "t1",
      title: "Cup",
      status: "IN_PROGRESS",
      entryFee: 500n,
      maxPlayers: 4,
      minLevel: 1,
      registrationEndsAt: joined,
      organizerId: "org1",
      createdAt: joined,
      participants: [{ userId: "u0", joinedAt: joined }],
      matches: [
        {
          id: "m1",
          roundNumber: 1,
          status: "PENDING",
          playerAId: "u0",
          playerBId: "u1",
          winnerId: null,
          awardsTournamentPrize: false,
          createdAt: joined,
        },
      ],
    });
    const controller = new TournamentController();
    const res = createMockResponse();
    await controller.getTournament(
      { params: { id: "t1" }, user: { id: "u1" } } as MockRequest as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const data = (res.json.mock.calls[0]?.[0] as Record<string, unknown>)
      ?.data as Record<string, unknown>;
    expect(data?.matches).toHaveLength(1);
    expect(data?.participants).toHaveLength(1);
    expect((data?.matches as unknown[])[0]).toMatchObject({
      matchId: "m1",
      roundNumber: 1,
    });
  });
});
