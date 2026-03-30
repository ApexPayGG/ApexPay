import jwt from "jsonwebtoken";
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { MatchSettlementError } from "./services/match-settlement.service.js";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

/** In-memory Redis compatible with idempotency middleware (Lua + MULTI/EXEC). */
class FakeRedis {
  private readonly store = new Map<string, string>();

  eval(
    _script: string,
    numKeys: number,
    ...rest: string[]
  ): Promise<string | null | [number, number]> {
    if (
      numKeys === 1 &&
      rest[0]?.startsWith("ratelimit:sliding:v1:resolve:user:")
    ) {
      return Promise.resolve([1, 1]);
    }
    if (numKeys !== 2 || rest.length < 3) {
      return Promise.resolve(null);
    }
    const sk = rest[0];
    const bk = rest[1];
    const ttlArg = rest[2];
    void ttlArg;
    const s = this.store.get(sk);
    if (s === undefined) {
      this.store.set(sk, "PENDING");
      return Promise.resolve("ACQUIRED");
    }
    if (s === "PENDING") {
      return Promise.resolve("PENDING");
    }
    if (s === "COMPLETE") {
      const b = this.store.get(bk);
      return Promise.resolve(b ?? "");
    }
    return Promise.resolve("UNKNOWN");
  }

  multi(): {
    set: (
      k: string,
      v: string,
      ex?: string,
      ttl?: number,
    ) => ReturnType<FakeRedis["multi"]>;
    exec: () => Promise<unknown[]>;
  } {
    const ops: Array<{ k: string; v: string }> = [];
    const self = this;
    return {
      set(k: string, v: string, _ex?: string, _ttl?: number) {
        ops.push({ k, v });
        return this;
      },
      exec() {
        for (const op of ops) {
          self.store.set(op.k, op.v);
        }
        return Promise.resolve(["OK", "OK"]);
      },
    };
  }

  del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) {
        n += 1;
      }
    }
    return Promise.resolve(n);
  }
}

describe("POST /api/v1/matches/:id/resolve (integration)", () => {
  const JWT_SECRET = "integration-test-secret";
  let successCount: number;
  let settleDisputedMatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    successCount = 0;
    settleDisputedMatch = vi.fn().mockImplementation(async () => {
      if (successCount > 0) {
        throw new MatchSettlementError("MATCH_ALREADY_SETTLED");
      }
      successCount += 1;
      return {
        matchId: "match-race-1",
        status: "SETTLED" as const,
        winnerId: "winner-1",
      };
    });
  });

  function token(): string {
    return jwt.sign({ userId: "arbiter-1" }, JWT_SECRET);
  }

  it("50 concurrent same matchId with distinct Idempotency-Key: one 200 and one settlement", async () => {
    const redis = new FakeRedis() as unknown as import("ioredis").default;
    const wsService = {
      notifyWallet: vi.fn(),
    } as unknown as WebSocketService;

    const { app } = createApp({
      prisma: {} as PrismaClient,
      redis,
      wsService,
      matchSettlementService: { settleDisputedMatch },
    });

    const reqs = Array.from({ length: 50 }, (_, i) =>
      request(app)
        .post("/api/v1/matches/match-race-1/resolve")
        .set("Authorization", `Bearer ${token()}`)
        .set("Idempotency-Key", `race-${i}`)
        .send({ finalWinnerId: "winner-1" }),
    );

    const responses = await Promise.all(reqs);
    const ok200 = responses.filter((r) => r.status === 200);
    const conflict409 = responses.filter((r) => r.status === 409);

    expect(ok200.length).toBe(1);
    expect(conflict409.length).toBe(49);
    expect(settleDisputedMatch).toHaveBeenCalledTimes(50);
    expect(successCount).toBe(1);
    expect(wsService.notifyWallet).toHaveBeenCalledTimes(1);
  });

  it("50 concurrent same matchId and same Idempotency-Key: one DB settlement; others 409 (pending) or cached 200", async () => {
    const redis = new FakeRedis() as unknown as import("ioredis").default;
    const wsService = {
      notifyWallet: vi.fn(),
    } as unknown as WebSocketService;

    const { app } = createApp({
      prisma: {} as PrismaClient,
      redis,
      wsService,
      matchSettlementService: { settleDisputedMatch },
    });

    const reqs = Array.from({ length: 50 }, () =>
      request(app)
        .post("/api/v1/matches/match-race-1/resolve")
        .set("Authorization", `Bearer ${token()}`)
        .set("Idempotency-Key", "single-key")
        .send({ finalWinnerId: "winner-1" }),
    );

    const responses = await Promise.all(reqs);
    const statuses = responses.map((r) => r.status);

    expect(settleDisputedMatch).toHaveBeenCalledTimes(1);
    expect(successCount).toBe(1);
    expect(wsService.notifyWallet).toHaveBeenCalledTimes(1);
    expect(statuses.length).toBe(50);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  });
});
