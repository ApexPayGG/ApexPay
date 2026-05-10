import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("POST /api/matches/:id/resolve (legacy integration)", () => {
  const JWT_SECRET = "legacy-match-resolve-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  function bearer(userId: string, role = "PLAYER"): string {
    return jwt.sign({ userId, role }, JWT_SECRET);
  }

  it("rejects non-admin callers before dispute payout logic runs", async () => {
    const prisma = {
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/matches/match-1/resolve")
      .set("Authorization", `Bearer ${bearer("player-1")}`)
      .send({ finalWinnerId: "player-1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
