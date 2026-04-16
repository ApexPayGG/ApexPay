import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("amqplib", () => ({
  connect: vi.fn(),
}));

import { connect } from "amqplib";
import {
  ApexpayWebhookRabbitMq,
  OUTBOX_DELIVERY_ROUTING_KEY,
  WEBHOOK_EXCHANGE,
} from "./rabbitmq.js";

describe("ApexpayWebhookRabbitMq", () => {
  beforeEach(() => {
    vi.mocked(connect).mockReset();
  });

  it("publishOutboxDelivery wysyła JSON z outboxId na exchange direct (confirm)", async () => {
    const publish = vi.fn(
      (
        _ex: string,
        _key: string,
        _buf: Buffer,
        _opts: object,
        cb?: (err: Error | undefined) => void,
      ) => {
        cb?.(undefined);
        return true;
      },
    );
    const assertExchange = vi.fn().mockResolvedValue(undefined);
    const assertQueue = vi.fn().mockResolvedValue(undefined);
    const bindQueue = vi.fn().mockResolvedValue(undefined);
    const createConfirmChannel = vi.fn(async () => ({
      assertExchange,
      assertQueue,
      bindQueue,
      publish,
      close: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(connect).mockResolvedValue({
      createConfirmChannel,
      createChannel: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    } as never);

    const mq = await ApexpayWebhookRabbitMq.connect("amqp://127.0.0.1");
    await mq.publishOutboxDelivery("wo_queue_test_1");

    expect(assertExchange).toHaveBeenCalledWith(WEBHOOK_EXCHANGE, "direct", {
      durable: true,
    });
    expect(assertQueue).toHaveBeenCalled();
    expect(bindQueue).toHaveBeenCalledWith(
      expect.any(String),
      WEBHOOK_EXCHANGE,
      OUTBOX_DELIVERY_ROUTING_KEY,
    );
    expect(publish).toHaveBeenCalledWith(
      WEBHOOK_EXCHANGE,
      OUTBOX_DELIVERY_ROUTING_KEY,
      expect.any(Buffer),
      { persistent: true },
      expect.any(Function),
    );
    const buf = publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buf.toString("utf8"))).toEqual({
      outboxId: "wo_queue_test_1",
    });

    await mq.close();
  });

  it("publish(outbox_delivery, { outboxId }) deleguje do publishOutboxDelivery", async () => {
    const publish = vi.fn(
      (
        _ex: string,
        _key: string,
        _buf: Buffer,
        _opts: object,
        cb?: (err: Error | undefined) => void,
      ) => {
        cb?.(undefined);
        return true;
      },
    );
    vi.mocked(connect).mockResolvedValue({
      createConfirmChannel: vi.fn(async () => ({
        assertExchange: vi.fn().mockResolvedValue(undefined),
        assertQueue: vi.fn().mockResolvedValue(undefined),
        bindQueue: vi.fn().mockResolvedValue(undefined),
        publish,
        close: vi.fn().mockResolvedValue(undefined),
      })),
      createChannel: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    } as never);

    const mq = await ApexpayWebhookRabbitMq.connect("amqp://x");
    await mq.publish("outbox_delivery", { outboxId: "wo_2" });
    const buf = publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buf.toString("utf8"))).toEqual({ outboxId: "wo_2" });
    await mq.close();
  });
});
