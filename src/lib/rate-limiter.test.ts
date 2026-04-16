import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { createRateLimiter } from "./rate-limiter.js";

type Entry = { count: number; expiresAt: number };

function createRedisMock() {
  const map = new Map<string, Entry>();

  const ensureFresh = (key: string): Entry | undefined => {
    const row = map.get(key);
    if (row === undefined) return undefined;
    if (Date.now() >= row.expiresAt) {
      map.delete(key);
      return undefined;
    }
    return row;
  };

  const redis = {
    incr: vi.fn(async (key: string) => {
      const existing = ensureFresh(key);
      if (existing === undefined) {
        map.set(key, { count: 1, expiresAt: Number.POSITIVE_INFINITY });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    }),
    pexpire: vi.fn(async (key: string, ttlMs: number) => {
      const row = map.get(key);
      if (row !== undefined) {
        row.expiresAt = Date.now() + ttlMs;
      }
      return 1;
    }),
    pttl: vi.fn(async (key: string) => {
      const row = ensureFresh(key);
      if (row === undefined) return -2;
      return Math.max(1, row.expiresAt - Date.now());
    }),
  };

  return redis as unknown as Redis;
}

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T10:00:00.000Z"));
    delete process.env.RATE_LIMIT_TRUSTED_IPS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("po max requestach kolejny zwraca 429 i nagłówki", async () => {
    const redis = createRedisMock();
    const app = express();
    app.use(express.json());
    app.use(
      createRateLimiter(redis, {
        windowMs: 60_000,
        max: 2,
        keyPrefix: "test",
        message: "limit hit",
      }),
    );
    app.get("/t", (_req, res) => res.status(200).json({ ok: true }));

    const a = await request(app).get("/t");
    expect(a.status).toBe(200);
    expect(a.headers["x-ratelimit-limit"]).toBe("2");
    expect(a.headers["x-ratelimit-remaining"]).toBe("1");

    const b = await request(app).get("/t");
    expect(b.status).toBe(200);
    expect(b.headers["x-ratelimit-remaining"]).toBe("0");

    const c = await request(app).get("/t");
    expect(c.status).toBe(429);
    expect(c.body.error).toBe("TOO_MANY_REQUESTS");
    expect(c.body.message).toBe("limit hit");
    expect(c.body.retryAfter).toBeTypeOf("number");
    expect(c.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("po upływie okna licznik resetuje się", async () => {
    const redis = createRedisMock();
    const app = express();
    app.use(
      createRateLimiter(redis, {
        windowMs: 10_000,
        max: 1,
        keyPrefix: "reset",
      }),
    );
    app.get("/t", (_req, res) => res.status(200).json({ ok: true }));

    const first = await request(app).get("/t");
    expect(first.status).toBe(200);
    const blocked = await request(app).get("/t");
    expect(blocked.status).toBe(429);

    vi.advanceTimersByTime(10_100);
    const after = await request(app).get("/t");
    expect(after.status).toBe(200);
  });

  it("trusted IP jest pomijane przez limiter", async () => {
    process.env.RATE_LIMIT_TRUSTED_IPS = "127.0.0.1";
    const redis = createRedisMock();
    const app = express();
    app.set("trust proxy", true);
    app.use(
      createRateLimiter(redis, {
        windowMs: 60_000,
        max: 1,
        keyPrefix: "trusted",
      }),
    );
    app.get("/t", (_req, res) => res.status(200).json({ ok: true }));

    const r1 = await request(app).get("/t");
    const r2 = await request(app).get("/t");
    const r3 = await request(app).get("/t");
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });
});

