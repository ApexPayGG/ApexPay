import CircuitBreaker from "opossum";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OutboxPollerService } from "./outbox-poller.service.js";
import type { MessageBroker } from "./message-broker.js";

describe("OutboxPollerService", () => {
  let publish: ReturnType<typeof vi.fn>;
  let broker: MessageBroker;
  let outboxUpdate: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let prisma: PrismaClient;

  beforeEach(() => {
    publish = vi.fn().mockResolvedValue(undefined);
    broker = { publish, close: vi.fn() } as unknown as MessageBroker;
    outboxUpdate = vi.fn().mockResolvedValue({});
    queryRaw = vi.fn();
    updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: queryRaw,
      outboxEvent: { updateMany },
    };
    prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
      outboxEvent: { update: outboxUpdate },
    } as unknown as PrismaClient;
  });

  it("pollOnce uses $queryRaw with FOR UPDATE SKIP LOCKED then marks PROCESSING", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "e1",
        eventType: "FUNDS_SETTLED",
        payload: { x: 1 },
        status: "PENDING",
        retryCount: 0,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const poller = new OutboxPollerService(prisma, broker, {
      maxRetries: 3,
    });
    await poller.pollOnce();

    expect(queryRaw).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["e1"] } },
      data: { status: "PROCESSING" },
    });
    expect(publish).toHaveBeenCalledWith("FUNDS_SETTLED", { x: 1 });
    expect(outboxUpdate).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { status: "PROCESSED" },
    });
  });

  it("on publish failure increments retry and sets PENDING when under maxRetries", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "e1",
        eventType: "X",
        payload: {},
        status: "PENDING",
        retryCount: 1,
        created_at: new Date(),
      },
    ]);
    publish.mockRejectedValue(new Error("broker down"));

    const poller = new OutboxPollerService(prisma, broker, { maxRetries: 5 });
    await poller.pollOnce();

    expect(outboxUpdate).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { status: "PENDING", retryCount: 2 },
    });
  });

  it("on publish failure sets FAILED when retries exhausted", async () => {
    queryRaw.mockResolvedValue([
      {
        id: "e1",
        eventType: "X",
        payload: {},
        status: "PENDING",
        retryCount: 4,
        created_at: new Date(),
      },
    ]);
    publish.mockRejectedValue(new Error("broker down"));

    const poller = new OutboxPollerService(prisma, broker, { maxRetries: 5 });
    await poller.pollOnce();

    expect(outboxUpdate).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { status: "FAILED", retryCount: 5 },
    });
  });

  it("pollOnce skips DB when circuit breaker is OPEN", async () => {
    const publishFn = vi.fn().mockResolvedValue(undefined);
    const broker = { publish: publishFn, close: vi.fn() } as unknown as MessageBroker;
    const breaker = new CircuitBreaker<[string, unknown], void>(
      (routingKey: string, payload: unknown) => broker.publish(routingKey, payload),
      {
        errorThresholdPercentage: 50,
        volumeThreshold: 10,
        resetTimeout: 30_000,
        rollingCountTimeout: 10_000,
      },
    );
    breaker.open();

    const poller = new OutboxPollerService(prisma, broker, { circuitBreaker: breaker });
    await poller.pollOnce();

    expect(queryRaw).not.toHaveBeenCalled();
    expect(publishFn).not.toHaveBeenCalled();
    poller.stop();
  });

  it("pollOnce swallows errors from transaction and does not rethrow", async () => {
    (prisma as unknown as { $transaction: typeof vi.fn }).$transaction =
      vi.fn().mockRejectedValue(new Error("db boom"));
    const poller = new OutboxPollerService(prisma, broker);
    await expect(poller.pollOnce()).resolves.toBeUndefined();
  });

  it("start schedules interval and stop clears it", () => {
    vi.useFakeTimers();
    const poller = new OutboxPollerService(prisma, broker, { intervalMs: 2000 });
    const pollSpy = vi.spyOn(poller, "pollOnce").mockResolvedValue(undefined);

    poller.start();
    expect(pollSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(pollSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(pollSpy).toHaveBeenCalledTimes(2);

    poller.stop();
    vi.advanceTimersByTime(10_000);
    expect(pollSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
