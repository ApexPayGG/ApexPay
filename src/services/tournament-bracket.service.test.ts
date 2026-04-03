import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TournamentBracketService } from "./tournament-bracket.service.js";

describe("TournamentBracketService.advanceAfterTerminalMatch", () => {
  let service: TournamentBracketService;

  beforeEach(() => {
    service = new TournamentBracketService({} as PrismaClient);
  });

  it("sets COMPLETED when the only match in a round is terminal", async () => {
    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const tournamentFindUnique = vi.fn().mockResolvedValue({
      id: "t1",
      status: "IN_PROGRESS",
    });
    const tournamentUpdate = vi.fn();
    const matchFindMany = vi.fn().mockResolvedValue([
      {
        id: "m1",
        tournamentId: "t1",
        roundNumber: 1,
        status: "RESOLVED",
        winnerId: "w1",
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    ]);
    const matchCreateMany = vi.fn();
    const tx = {
      $executeRaw: executeRaw,
      tournament: { findUnique: tournamentFindUnique, update: tournamentUpdate },
      match: { findMany: matchFindMany, createMany: matchCreateMany },
    };

    const r = await service.advanceAfterTerminalMatch("t1", tx as never);

    expect(r.tournamentCompleted).toBe(true);
    expect(r.createdNextRoundMatches).toBe(0);
    expect(tournamentUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "COMPLETED" },
    });
    expect(matchCreateMany).not.toHaveBeenCalled();
  });

  it("creates one final-round match when two round-1 matches are done", async () => {
    const tournamentFindUnique = vi.fn().mockResolvedValue({
      id: "t1",
      status: "IN_PROGRESS",
    });
    const tournamentUpdate = vi.fn();
    const matchFindMany = vi.fn().mockResolvedValue([
      {
        id: "m1",
        tournamentId: "t1",
        roundNumber: 1,
        status: "RESOLVED",
        winnerId: "w1",
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
      },
      {
        id: "m2",
        tournamentId: "t1",
        roundNumber: 1,
        status: "RESOLVED",
        winnerId: "w2",
        createdAt: new Date("2026-01-01T13:00:00.000Z"),
      },
    ]);
    const matchCreateMany = vi.fn();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      tournament: { findUnique: tournamentFindUnique, update: tournamentUpdate },
      match: { findMany: matchFindMany, createMany: matchCreateMany },
    };

    const r = await service.advanceAfterTerminalMatch("t1", tx as never);

    expect(r.tournamentCompleted).toBe(false);
    expect(r.createdNextRoundMatches).toBe(1);
    expect(matchCreateMany).toHaveBeenCalledWith({
      data: [
        {
          tournamentId: "t1",
          roundNumber: 2,
          status: "PENDING",
          playerAId: "w1",
          playerBId: "w2",
          awardsTournamentPrize: true,
        },
      ],
    });
    expect(tournamentUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when tournament is not IN_PROGRESS", async () => {
    const tournamentFindUnique = vi.fn().mockResolvedValue({
      id: "t1",
      status: "COMPLETED",
    });
    const matchFindMany = vi.fn();
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      tournament: { findUnique: tournamentFindUnique, update: vi.fn() },
      match: { findMany: matchFindMany, createMany: vi.fn() },
    };

    const r = await service.advanceAfterTerminalMatch("t1", tx as never);

    expect(r.tournamentCompleted).toBe(false);
    expect(r.createdNextRoundMatches).toBe(0);
    expect(matchFindMany).not.toHaveBeenCalled();
  });
});
