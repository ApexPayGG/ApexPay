import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Channel, ConsumeMessage } from "amqplib";
import type { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";
import { SettlementEventConsumerService } from "./settlement-event-consumer.service.js";

function createMockChannel(
  consumeCbRef: { current?: (msg: ConsumeMessage | null) => void },
) {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({ queue: "q" }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn((_q, cb) => {
      consumeCbRef.current = cb;
      return Promise.resolve({ consumerTag: "ctag-1" });
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SettlementEventConsumerService", () => {
  let consumeCb: ((msg: ConsumeMessage | null) => void) | undefined;
  let mockChannel: ReturnType<typeof createMockChannel>;
  let consumeCbRef: { current?: (msg: ConsumeMessage | null) => void };

  beforeEach(() => {
    consumeCbRef = {};
    mockChannel = createMockChannel(consumeCbRef);
    consumeCb = (msg) => consumeCbRef.current?.(msg);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBroker(
    emitter: EventEmitter,
    createConsumerChannel: ReturnType<typeof vi.fn>,
  ): RabbitMqConnectionManager {
    const broker = emitter as unknown as RabbitMqConnectionManager;
    broker.waitForReady = vi.fn().mockResolvedValue(undefined);
    broker.createConsumerChannel = createConsumerChannel;
    return broker;
  }

  it("asserts topology, prefetch 10, consume with noAck false", async () => {
    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, vi.fn().mockResolvedValue(mockChannel as unknown as Channel)),
      { exchangeName: "apexpay.events" },
    );
    await svc.start();

    expect(mockChannel.assertExchange).toHaveBeenCalledWith(
      "apexpay.events",
      "topic",
      { durable: true },
    );
    expect(mockChannel.assertQueue).toHaveBeenNthCalledWith(
      1,
      "apexpay.events.dlq",
      { durable: true },
    );
    expect(mockChannel.assertQueue).toHaveBeenNthCalledWith(
      2,
      "apexpay.events.settlement_queue",
      {
        durable: true,
        deadLetterExchange: "",
        deadLetterRoutingKey: "apexpay.events.dlq",
      },
    );
    expect(mockChannel.bindQueue).toHaveBeenCalledWith(
      "apexpay.events.settlement_queue",
      "apexpay.events",
      "FUNDS_SETTLED",
    );
    expect(mockChannel.prefetch).toHaveBeenCalledWith(10);
    expect(mockChannel.consume).toHaveBeenCalledWith(
      "apexpay.events.settlement_queue",
      expect.any(Function),
      { noAck: false },
    );
    await svc.stop();
  });

  it("acks after simulated processing", async () => {
    vi.useFakeTimers();
    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, vi.fn().mockResolvedValue(mockChannel as unknown as Channel)),
      { exchangeName: "apexpay.events" },
    );
    await svc.start();

    const msg = {
      content: Buffer.from(JSON.stringify({ matchId: "match-x" })),
    } as ConsumeMessage;

    consumeCb?.(msg);
    await vi.advanceTimersByTimeAsync(100);

    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
    expect(mockChannel.nack).not.toHaveBeenCalled();

    await svc.stop();
  });

  it("nacks on invalid JSON (DLQ path)", async () => {
    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, vi.fn().mockResolvedValue(mockChannel as unknown as Channel)),
      { exchangeName: "apexpay.events" },
    );
    await svc.start();

    const msg = {
      content: Buffer.from("not-json"),
    } as ConsumeMessage;

    consumeCb?.(msg);
    await Promise.resolve();

    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();

    await svc.stop();
  });

  it("start is idempotent", async () => {
    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, vi.fn().mockResolvedValue(mockChannel as unknown as Channel)),
      { exchangeName: "apexpay.events" },
    );
    await svc.start();
    await svc.start();
    expect(mockChannel.consume).toHaveBeenCalledTimes(1);
    await svc.stop();
  });

  it("registers single reconnected listener; stop removes it", async () => {
    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, vi.fn().mockResolvedValue(mockChannel as unknown as Channel)),
      { exchangeName: "apexpay.events" },
    );
    expect(emitter.listenerCount("reconnected")).toBe(1);
    await svc.start();
    expect(emitter.listenerCount("reconnected")).toBe(1);
    await svc.stop();
    expect(emitter.listenerCount("reconnected")).toBe(0);
  });

  it("emits reconnected triggers channel rebuild and log", async () => {
    const consumeCbRef2 = {};
    const mockChannel2 = createMockChannel(consumeCbRef2);
    const createCh = vi
      .fn()
      .mockResolvedValueOnce(mockChannel as unknown as Channel)
      .mockResolvedValueOnce(mockChannel2 as unknown as Channel);

    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, createCh),
      { exchangeName: "apexpay.events" },
    );
    await svc.start();
    expect(createCh).toHaveBeenCalledTimes(1);

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    emitter.emit("reconnected", {});
    await vi.waitFor(() => {
      expect(mockChannel.close).toHaveBeenCalled();
    });
    expect(info).toHaveBeenCalledWith(
      "Odtwarzanie kanału konsumenta po restarcie połączenia RabbitMQ...",
    );
    expect(createCh).toHaveBeenCalledTimes(2);
    expect(mockChannel2.consume).toHaveBeenCalled();
    info.mockRestore();
    await svc.stop();
  });

  it("ignores reconnected before start", async () => {
    const createCh = vi.fn().mockResolvedValue(mockChannel as unknown as Channel);
    const emitter = new EventEmitter();
    const svc = new SettlementEventConsumerService(
      makeBroker(emitter, createCh),
      { exchangeName: "apexpay.events" },
    );
    emitter.emit("reconnected", {});
    await Promise.resolve();
    expect(createCh).not.toHaveBeenCalled();
    await svc.start();
    expect(createCh).toHaveBeenCalledTimes(1);
    await svc.stop();
  });
});
