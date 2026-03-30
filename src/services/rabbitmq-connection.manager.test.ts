import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connect } from "amqplib";
import { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";

vi.mock("amqplib", () => ({
  connect: vi.fn(),
}));

async function flushUntilReady(mgr: RabbitMqConnectionManager): Promise<void> {
  for (let i = 0; i < 100 && !mgr.isReady(); i += 1) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

describe("RabbitMqConnectionManager", () => {
  const mockConnect = vi.mocked(connect);

  beforeEach(() => {
    mockConnect.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("publish resolves only after confirm callback (ACK)", async () => {
    const confirmCb = vi.fn();
    const mockCh = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(
        (
          _ex: string,
          _key: string,
          _buf: Buffer,
          _opts: unknown,
          cb?: (err: unknown) => void,
        ) => {
          confirmCb();
          queueMicrotask(() => {
            cb?.(null);
          });
          return true;
        },
      ),
      close: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
    };
    const mockConn = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockCh),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockConnect.mockResolvedValue(mockConn as never);

    const mgr = new RabbitMqConnectionManager({
      url: "amqp://localhost",
      exchangeName: "ex.test",
    });
    await flushUntilReady(mgr);
    expect(mgr.isReady()).toBe(true);

    await mgr.publish("FUNDS_SETTLED", { x: 1 });

    expect(mockCh.publish).toHaveBeenCalled();
    expect(confirmCb).toHaveBeenCalled();
    await mgr.close();
  });

  it("publish rejects when confirm callback receives error", async () => {
    const mockCh = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(
        (
          _ex: string,
          _key: string,
          _buf: Buffer,
          _opts: unknown,
          cb?: (err: unknown) => void,
        ) => {
          queueMicrotask(() => {
            cb?.(new Error("nack"));
          });
          return true;
        },
      ),
      close: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
    };
    const mockConn = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockCh),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockConnect.mockResolvedValue(mockConn as never);

    const mgr = new RabbitMqConnectionManager({
      url: "amqp://localhost",
      exchangeName: "ex.test",
    });
    await flushUntilReady(mgr);

    await expect(mgr.publish("k", {})).rejects.toThrow("nack");
    await mgr.close();
  });

  it("waitForReady and createConsumerChannel use connection.createChannel", async () => {
    const mockConsumerCh = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockCh = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
    };
    const mockConn = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockCh),
      createChannel: vi.fn().mockResolvedValue(mockConsumerCh),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockConnect.mockResolvedValue(mockConn as never);

    const mgr = new RabbitMqConnectionManager({
      url: "amqp://localhost",
      exchangeName: "ex.test",
    });
    await flushUntilReady(mgr);

    const ch = await mgr.createConsumerChannel();
    expect(mockConn.createChannel).toHaveBeenCalledTimes(1);
    expect(ch).toBe(mockConsumerCh);
    await mgr.close();
  });

  it("emits reconnected with connection after successful connect", async () => {
    const onReconnected = vi.fn();
    const mockCh = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
    };
    const mockConn = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockCh),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockConnect.mockResolvedValue(mockConn as never);

    const mgr = new RabbitMqConnectionManager({
      url: "amqp://localhost",
      exchangeName: "ex.test",
    });
    mgr.on("reconnected", onReconnected);
    await flushUntilReady(mgr);

    expect(onReconnected).toHaveBeenCalledTimes(1);
    expect(onReconnected.mock.calls[0][0]).toBe(mockConn);
    await mgr.close();
  });
});
