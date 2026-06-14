import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ClearingService } from "../services/clearing.service.js";
import type { TournamentBracketService } from "../services/tournament-bracket.service.js";
import type { WebSocketService } from "../services/websocket.service.js";
import { MatchController } from "./match.controller.js";

type MockReq = {
  params: { id: string };
  body: { finalWinnerId: string };
  user: { id: string };
};

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

function createHarness(status: string) {
  const matchFindUnique = vi.fn().mockResolvedValue({
    id: "match-1",
    tournamentId: "tournament-1",
    status,
    winnerId: null,
    playerAId: "player-a",
    playerBId: "player-b",
  });
  const matchUpdate = vi.fn();
  const mockTx = {
    match: { findUnique: matchFindUnique, update: matchUpdate },
  };
  const prisma = {
    $transaction: vi.fn(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    ),
  } as unknown as PrismaClient;
  const clearingService = {
    processPayout: vi.fn().mockResolvedValue(true),
  } as unknown as ClearingService;
  const bracketService = {
    advanceAfterTerminalMatch: vi.fn(),
  } as unknown as TournamentBracketService;
  const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

  return {
    controller: new MatchController(
      prisma,
      clearingService,
      wsService,
      bracketService,
    ),
    matchUpdate,
    clearingService,
    bracketService,
  };
}

async function resolveWithStatus(status: string) {
  const harness = createHarness(status);
  const res = mockRes();
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  await harness.controller.resolveDispute(
    {
      params: { id: "match-1" },
      body: { finalWinnerId: "player-a" },
      user: { id: "admin-1" },
    } as MockReq as never,
    res as never,
  );

  errSpy.mockRestore();
  return { ...harness, res };
}

describe("legacy match resolve settlement state guard", () => {
  it.each(["PENDING", "SETTLED"])(
    "rejects %s matches without payout side effects",
    async (status) => {
      const result = await resolveWithStatus(status);

      expect(result.res.status).toHaveBeenCalledWith(409);
      expect(result.matchUpdate).not.toHaveBeenCalled();
      expect(result.clearingService.processPayout).not.toHaveBeenCalled();
      expect(result.bracketService.advanceAfterTerminalMatch).not.toHaveBeenCalled();
    },
  );
});
