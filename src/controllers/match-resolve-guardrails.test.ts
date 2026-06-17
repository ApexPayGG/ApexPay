import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ClearingService } from "../services/clearing.service.js";
import type { TournamentBracketService } from "../services/tournament-bracket.service.js";
import type { WebSocketService } from "../services/websocket.service.js";
import { MatchController } from "./match.controller.js";

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("MatchController.resolveDispute guardrails", () => {
  it("rejects SETTLED matches without running payout again", async () => {
    const tx = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: "match-1",
          tournamentId: "tournament-1",
          status: "SETTLED",
          winnerId: "winner-old",
          playerAId: "winner-old",
          playerBId: "player-2",
        }),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const clearingService = {
      processPayout: vi.fn(),
    } as unknown as ClearingService;
    const bracketService = {
      advanceAfterTerminalMatch: vi.fn(),
    } as unknown as TournamentBracketService;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const controller = new MatchController(
      prisma,
      clearingService,
      wsService,
      bracketService,
    );
    const res = mockRes();

    await controller.resolveDispute(
      {
        params: { id: "match-1" },
        body: { finalWinnerId: "player-2" },
        user: { id: "admin-1" },
      } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(clearingService.processPayout).not.toHaveBeenCalled();
    expect(bracketService.advanceAfterTerminalMatch).not.toHaveBeenCalled();
    expect(wsService.notifyWallet).not.toHaveBeenCalled();
  });
});
