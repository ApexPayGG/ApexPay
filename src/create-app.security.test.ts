import jwt from "jsonwebtoken";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { UserRole, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

class FakeRedis {
  private readonly store = new Map<string, string>();

  ping(): Promise<string> {
    return Promise.resolve("PONG");
  }

  eval(_script: string, numKeys: number, ...rest: string[]): Promise<string | [number, number] | null> {
    if (numKeys === 1) {
      return Promise.resolve([1, 1]);
    }
    const stateKey = rest[0];
    const bodyKey = rest[1];
    if (stateKey === undefined || bodyKey === undefined) {
      return Promise.resolve(null);
    }
    const state = this.store.get(stateKey);
    if (state === undefined) {
      this.store.set(stateKey, "PENDING");
      return Promise.resolve("ACQUIRED");
    }
    if (state === "PENDING") {
      return Promise.resolve("PENDING");
    }
    if (state === "COMPLETE") {
      return Promise.resolve(this.store.get(bodyKey) ?? "");
    }
    return Promise.resolve("UNKNOWN");
  }

  multi(): {
    set: (key: string, value: string, ex?: string, ttl?: number) => ReturnType<FakeRedis["multi"]>;
    exec: () => Promise<unknown[]>;
  } {
    const ops: Array<{ key: string; value: string }> = [];
    const self = this;
    return {
      set(key: string, value: string, _ex?: string, _ttl?: number) {
        ops.push({ key, value });
        return this;
      },
      exec() {
        for (const op of ops) {
          self.store.set(op.key, op.value);
        }
        return Promise.resolve(["OK", "OK"]);
      },
    };
  }

  set(): Promise<"OK"> {
    return Promise.resolve("OK");
  }

  del(): Promise<number> {
    return Promise.resolve(1);
  }
}

describe("createApp critical money-movement route authorization", () => {
  const JWT_SECRET = "security-test-secret";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.JWT_SECRET;
  });

  function token(role: UserRole): string {
    return jwt.sign({ userId: "user_1", role }, JWT_SECRET);
  }

  function buildApp() {
    const prisma = {
      $transaction: vi.fn(async () => {
        throw new Error("money movement should be blocked before Prisma");
      }),
    } as unknown as PrismaClient;
    const redis = new FakeRedis() as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;
    const settleDisputedMatch = vi.fn().mockResolvedValue({
      matchId: "match_1",
      status: "SETTLED",
      winnerId: "player_a",
      prizePaid: true,
    });
    const { app } = createApp({
      prisma,
      redis,
      wsService,
      matchSettlementService: { settleDisputedMatch },
    });
    return { app, prisma, settleDisputedMatch };
  }

  it("forbids normal players from minting funds through the legacy deposit route", async () => {
    const { app, prisma } = buildApp();

    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .send({ amount: "100000", referenceId: "self-mint-1" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("forbids normal players from resolving legacy matches and triggering payouts", async () => {
    const { app, prisma } = buildApp();

    const res = await request(app)
      .post("/api/matches/match_1/resolve")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .send({ finalWinnerId: "player_a" });

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("forbids normal players from resolving v1 matches and triggering settlement", async () => {
    const { app, settleDisputedMatch } = buildApp();

    const res = await request(app)
      .post("/api/v1/matches/match_1/resolve")
      .set("Authorization", `Bearer ${token(UserRole.PLAYER)}`)
      .set("Idempotency-Key", "resolve-player-1")
      .send({ finalWinnerId: "player_a" });

    expect(res.status).toBe(403);
    expect(settleDisputedMatch).not.toHaveBeenCalled();
  });
});
