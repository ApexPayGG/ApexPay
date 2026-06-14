import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserRole } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "../create-app.js";
import type { WebSocketService } from "../services/websocket.service.js";

function playerToken(): string {
  return jwt.sign(
    { userId: "player-1", role: UserRole.PLAYER },
    process.env.JWT_SECRET ?? "vitest-jwt-secret",
  );
}

describe("legacy match resolve route authorization", () => {
  it("rejects player JWTs before dispute resolution can mutate match state", async () => {
    const prismaTransaction = vi.fn();
    const prisma = { $transaction: prismaTransaction } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app)
      .post("/api/matches/match-1/resolve")
      .set("Authorization", `Bearer ${playerToken()}`)
      .send({ finalWinnerId: "player-1" });

    expect(res.status).toBe(403);
    expect(prismaTransaction).not.toHaveBeenCalled();
  });
});
