import jwt from "jsonwebtoken";
import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import type { PrismaClient, UserRole } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

class FakeRedis {
  ping(): Promise<string> {
    return Promise.resolve("PONG");
  }

  incr(): Promise<number> {
    return Promise.resolve(1);
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }

  del(): Promise<number> {
    return Promise.resolve(1);
  }

  eval(
    _script: string,
    numKeys: number,
    ...rest: string[]
  ): Promise<string | null | [number, number]> {
    if (numKeys === 1 && rest[0]?.startsWith("ratelimit:sliding:")) {
      return Promise.resolve([1, 1]);
    }
    if (numKeys === 2) {
      return Promise.resolve("ACQUIRED");
    }
    return Promise.resolve(null);
  }

  multi(): {
    set: () => ReturnType<FakeRedis["multi"]>;
    exec: () => Promise<unknown[]>;
  } {
    return {
      set() {
        return this;
      },
      exec() {
        return Promise.resolve(["OK", "OK"]);
      },
    };
  }
}

describe("critical money routes require admin role", () => {
  const JWT_SECRET = "critical-route-auth-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  function token(role: UserRole | "PLAYER" = "PLAYER"): string {
    return jwt.sign({ userId: "user_1", role }, JWT_SECRET);
  }

  function appWithSettlementMock(settleDisputedMatch = vi.fn()) {
    return createApp({
      prisma: {} as PrismaClient,
      redis: new FakeRedis() as unknown as Redis,
      wsService: { notifyWallet: vi.fn() } as unknown as WebSocketService,
      matchSettlementService: { settleDisputedMatch },
    }).app;
  }

  it("blocks PLAYER self-credit through legacy wallet deposit", async () => {
    const app = appWithSettlementMock();

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${token()}`)
      .send({ amount: "100000", referenceId: "attacker-ref-1" });

    expect(res.status).toBe(403);
  });

  it("blocks PLAYER legacy disputed match settlement", async () => {
    const settleDisputedMatch = vi.fn();
    const app = appWithSettlementMock(settleDisputedMatch);

    const res = await request(app)
      .post("/api/matches/match_1/resolve")
      .set("Authorization", `Bearer ${token()}`)
      .send({ finalWinnerId: "user_1" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });

  it("blocks PLAYER v1 disputed match settlement before idempotency work", async () => {
    const settleDisputedMatch = vi.fn();
    const app = appWithSettlementMock(settleDisputedMatch);

    const res = await request(app)
      .post("/api/v1/matches/match_1/resolve")
      .set("Authorization", `Bearer ${token()}`)
      .set("Idempotency-Key", "regular-user-attempt")
      .send({ finalWinnerId: "user_1" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });
});
