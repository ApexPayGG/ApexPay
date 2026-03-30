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
  const mockTx = {
    tournament: { findUnique: tournamentFindUnique, update: tournamentUpdate },
    tournamentParticipant: {
      findUnique: tournamentParticipantFindUnique,
      create: tournamentParticipantCreate,
    },
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
    tournament = { create: h.tournamentCreate };
    $transaction = h.prismaTransaction;
  }
  return { ...mod, PrismaClient: MockPrismaClient };
});

import { TournamentController } from "./tournament.controller.js";

type MockRequest = {
  body: Record<string, unknown>;
  user?: { id: string };
  params?: Record<string, string>;
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
  h.walletFindUnique.mockReset();
  h.walletUpdate.mockReset();
  h.ledgerCreate.mockReset();
  h.prismaTransaction.mockReset();
  h.prismaTransaction.mockImplementation(async (fn) => fn(h.mockTx));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tournamentCreate.mockReset();
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
