import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ClearingService } from "../services/clearing.service.js";
import type { TournamentBracketService } from "../services/tournament-bracket.service.js";
import type { WebSocketService } from "../services/websocket.service.js";
import { MatchController } from "./match.controller.js";

function createHarness() {
  const matchFindUnique = vi.fn();
  const matchUpdate = vi.fn();
  const mockTx = {
    match: { findUnique: matchFindUnique, update: matchUpdate },
  };
  const prismaTransaction = vi.fn(
    async (fn: (t: typeof mockTx) => Promise<unknown>) => fn(mockTx),
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
    matchUpdate,
    processPayout,
    advanceAfterTerminalMatch,
    notifyWallet,
  };
}

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("MatchController.resolveDispute SETTLED replay", () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    h = createHarness();
  });

  it("returns 409 and does not pay again when v1 already SETTLED the match", async () => {
    h.matchFindUnique.mockResolvedValue({
      id: "m1",
      tournamentId: "t1",
      status: "SETTLED",
      winnerId: "winner-1",
      playerAId: "winner-1",
      playerBId: "p2",
    });
    const res = mockRes();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.resolveDispute(
      {
        params: { id: "m1" },
        body: { finalWinnerId: "winner-1" },
        user: { id: "arb" },
      } as never,
      res as never,
    );

    errSpy.mockRestore();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(h.processPayout).not.toHaveBeenCalled();
    expect(h.matchUpdate).not.toHaveBeenCalled();
    expect(h.notifyWallet).not.toHaveBeenCalled();
  });
});
