import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createApp } from "./create-app.js";
import type { WebSocketService } from "./services/websocket.service.js";

describe("createApp health endpoints", () => {
  it("GET /health returns ok", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready returns ready when DB and Redis respond", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("PONG") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
  });

  it("GET /health/ready returns 503 when Redis ping fails", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([1]),
    } as unknown as PrismaClient;
    const redis = { ping: vi.fn().mockResolvedValue("NOPE") } as unknown as Redis;
    const wsService = { notifyWallet: vi.fn() } as unknown as WebSocketService;

    const { app } = createApp({ prisma, redis, wsService });

    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", code: "SERVICE_UNAVAILABLE" });
  });
});
