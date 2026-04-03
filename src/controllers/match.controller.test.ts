import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { ClearingService } from "../services/clearing.service.js";
import type { TournamentBracketService } from "../services/tournament-bracket.service.js";
import type { WebSocketService } from "../services/websocket.service.js";
import { MatchController } from "./match.controller.js";

function createHarness() {
  const matchFindUnique = vi.fn();
  const matchReportCreate = vi.fn();
  const matchReportFindMany = vi.fn();
  const matchUpdate = vi.fn();
  const mockTx = {
    match: { findUnique: matchFindUnique, update: matchUpdate },
    matchReport: { create: matchReportCreate, findMany: matchReportFindMany },
  };
  const prismaTransaction = vi.fn(
    async (fn: (t: typeof mockTx) => Promise<unknown>, _opts?: unknown) =>
      fn(mockTx),
  );
  const prisma = {
    $transaction: prismaTransaction,
  } as unknown as PrismaClient;
  const processPayout = vi.fn().mockResolvedValue(true);
  const clearingService = { processPayout } as unknown as ClearingService;
  const advanceAfterTerminalMatch = vi.fn().mockResolvedValue({
    tournamentCompleted: false,
    createdNextRoundMatches: 0,
  });
  const bracketService = {
    advanceAfterTerminalMatch,
  } as unknown as TournamentBracketService;
  const notifyWallet = vi.fn();
  const wsService = { notifyWallet } as unknown as WebSocketService;
  const controller = new MatchController(
    prisma,
    clearingService,
    wsService,
    bracketService,
  );
  return {
    controller,
    matchFindUnique,
    matchReportCreate,
    matchReportFindMany,
    matchUpdate,
    mockTx,
    prismaTransaction,
    processPayout,
    advanceAfterTerminalMatch,
    notifyWallet,
  };
}

type MockReq = {
  params: { id?: string };
  body: { claimedWinnerId?: string; finalWinnerId?: string };
  user?: { id: string };
};

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

let h: ReturnType<typeof createHarness>;

beforeEach(() => {
  h = createHarness();
});

describe("MatchController.reportResult", () => {
  it("returns 401 without authenticated user", async () => {
    const res = mockRes();
    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "w1" },
      } as MockReq as never,
      res as never,
    );
    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when match id or claimedWinnerId missing", async () => {
    const res = mockRes();
    await h.controller.reportResult(
      {
        params: { id: "" },
        body: { claimedWinnerId: "w1" },
        user: { id: "r1" },
      } as MockReq as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when match not found", async () => {
    h.matchFindUnique.mockResolvedValue(null);
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.reportResult(
      {
        params: { id: "missing" },
        body: { claimedWinnerId: "w1" },
        user: { id: "r1" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    errSpy.mockRestore();
  });

  it("returns 409 when match is not PENDING", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "RESOLVED",
      reports: [],
    });
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "w1" },
        user: { id: "r1" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });

  it("returns 403 when reporter is not an assigned player", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "PENDING",
      reports: [],
      playerAId: "pa",
      playerBId: "pb",
    });
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "pa" },
        user: { id: "outsider" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    errSpy.mockRestore();
  });

  it("returns 400 when claimed winner is not an assigned player", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "PENDING",
      reports: [],
      playerAId: "pa",
      playerBId: "pb",
    });
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "outsider" },
        user: { id: "pa" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    errSpy.mockRestore();
  });

  it("returns 200 PENDING_OPPONENT after first report", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "PENDING",
      reports: [],
    });
    h.matchReportFindMany.mockResolvedValue([{ claimedWinnerId: "a" }]);

    const res = mockRes();

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "player-a" },
        user: { id: "r1" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body?.matchState).toBe("PENDING_OPPONENT");
    expect(h.processPayout).not.toHaveBeenCalled();
    expect(h.notifyWallet).not.toHaveBeenCalled();
    expect(h.advanceAfterTerminalMatch).not.toHaveBeenCalled();
  });

  it("returns 200 RESOLVED and runs clearing in same tx", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "PENDING",
      reports: [],
    });
    h.matchReportFindMany.mockResolvedValue([
      { claimedWinnerId: "winner-1" },
      { claimedWinnerId: "winner-1" },
    ]);

    const res = mockRes();

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "winner-1" },
        user: { id: "r2" },
      } as MockReq as never,
      res as never,
    );

    expect(h.matchUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "RESOLVED", winnerId: "winner-1" },
    });
    expect(h.processPayout).toHaveBeenCalledTimes(1);
    expect(h.processPayout).toHaveBeenCalledWith(
      "m1",
      "winner-1",
      h.mockTx,
    );
    expect(h.advanceAfterTerminalMatch).toHaveBeenCalledWith("t1", h.mockTx);
    expect(h.notifyWallet).toHaveBeenCalledWith(
      "winner-1",
      "PAYOUT_RECEIVED",
      expect.objectContaining({
        message: expect.stringContaining("Konsensus") as string,
        matchId: "m1",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body?.matchState).toBe("RESOLVED");
  });

  it("does not send payout WS when processPayout returns false", async () => {
    h.processPayout.mockResolvedValueOnce(false);
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "PENDING",
      reports: [],
    });
    h.matchReportFindMany.mockResolvedValue([
      { claimedWinnerId: "winner-1" },
      { claimedWinnerId: "winner-1" },
    ]);
    const res = mockRes();

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "winner-1" },
        user: { id: "r2" },
      } as MockReq as never,
      res as never,
    );

    expect(h.advanceAfterTerminalMatch).toHaveBeenCalledWith("t1", h.mockTx);
    expect(h.notifyWallet).not.toHaveBeenCalled();
  });

  it("returns 200 DISPUTED when reports disagree", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "PENDING",
      reports: [],
    });
    h.matchReportFindMany.mockResolvedValue([
      { claimedWinnerId: "a" },
      { claimedWinnerId: "b" },
    ]);

    const res = mockRes();

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "b" },
        user: { id: "r2" },
      } as MockReq as never,
      res as never,
    );

    expect(h.matchUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "DISPUTED" },
    });
    expect(h.processPayout).not.toHaveBeenCalled();
    expect(h.notifyWallet).not.toHaveBeenCalled();
    expect(h.advanceAfterTerminalMatch).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body?.matchState).toBe("DISPUTED");
  });

  it("returns 409 on P2002 duplicate report", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "PENDING",
      reports: [],
    });
    h.prismaTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.reportResult(
      {
        params: { id: "m1" },
        body: { claimedWinnerId: "w1" },
        user: { id: "r1" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });
});

describe("MatchController.resolveDispute", () => {
  it("returns 400 when match id or finalWinnerId missing", async () => {
    const res = mockRes();
    await h.controller.resolveDispute(
      {
        params: { id: "" },
        body: { finalWinnerId: "w1" },
        user: { id: "arb" },
      } as MockReq as never,
      res as never,
    );
    expect(h.prismaTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when match not found", async () => {
    h.matchFindUnique.mockResolvedValue(null);
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.resolveDispute(
      {
        params: { id: "m1" },
        body: { finalWinnerId: "w1" },
        user: { id: "arb" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    errSpy.mockRestore();
  });

  it("returns 409 when match already resolved", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "RESOLVED",
      winnerId: "old",
    });
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.resolveDispute(
      {
        params: { id: "m1" },
        body: { finalWinnerId: "w1" },
        user: { id: "arb" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    errSpy.mockRestore();
  });

  it("returns 400 when final winner is not an assigned player", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      status: "DISPUTED",
      winnerId: null,
      playerAId: "pa",
      playerBId: "pb",
    });
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.resolveDispute(
      {
        params: { id: "m1" },
        body: { finalWinnerId: "outsider" },
        user: { id: "arb" },
      } as MockReq as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    errSpy.mockRestore();
  });

  it("returns 200 and runs payout in same tx", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "DISPUTED",
      winnerId: null,
    });
    h.matchUpdate.mockResolvedValue({});
    const res = mockRes();

    await h.controller.resolveDispute(
      {
        params: { id: "m1" },
        body: { finalWinnerId: "winner-1" },
        user: { id: "arb" },
      } as MockReq as never,
      res as never,
    );

    expect(h.matchUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "RESOLVED", winnerId: "winner-1" },
    });
    expect(h.processPayout).toHaveBeenCalledWith(
      "m1",
      "winner-1",
      h.mockTx,
    );
    expect(h.advanceAfterTerminalMatch).toHaveBeenCalledWith("t1", h.mockTx);
    expect(h.notifyWallet).toHaveBeenCalledWith(
      "winner-1",
      "PAYOUT_RECEIVED",
      expect.objectContaining({
        message: expect.stringContaining("Spór rozstrzygnięty") as string,
        matchId: "m1",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not notify wallet when processPayout skips prize round", async () => {
    h.processPayout.mockResolvedValueOnce(false);
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "DISPUTED",
      winnerId: null,
    });
    h.matchUpdate.mockResolvedValue({});
    const res = mockRes();

    await h.controller.resolveDispute(
      {
        params: { id: "m1" },
        body: { finalWinnerId: "winner-1" },
        user: { id: "arb" },
      } as MockReq as never,
      res as never,
    );

    expect(h.advanceAfterTerminalMatch).toHaveBeenCalledWith("t1", h.mockTx);
    expect(h.notifyWallet).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
