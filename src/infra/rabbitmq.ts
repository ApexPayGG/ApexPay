import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

/** Exchange typu direct dla webhooków (osobny od `apexpay.events` używanego przy settlement). */
export const WEBHOOK_EXCHANGE = "apexpay.webhooks";

export const OUTBOX_DELIVERY_QUEUE = "outbox_delivery";

/** Routing key zgodny z nazwą kolejki (direct exchange). */
export const OUTBOX_DELIVERY_ROUTING_KEY = "outbox_delivery";

export type OutboxDeliveryPayload = { outboxId: string };

/**
 * Połączenie RabbitMQ wyłącznie dla kolejki outbox webhooków.
 * Publikacja przez confirm channel; konsumpcja na osobnym kanale.
 */
export class ApexpayWebhookRabbitMq {
  private connection: ChannelModel | null = null;
  private publishChannel: ConfirmChannel | null = null;
  private consumerChannel: Channel | null = null;
  private consumerTag: string | null = null;
  private closing = false;

  private constructor(private readonly url: string) {}

  static async connect(url: string): Promise<ApexpayWebhookRabbitMq> {
    const inst = new ApexpayWebhookRabbitMq(url);
    await inst.init();
    return inst;
  }

  private async init(): Promise<void> {
    const conn = await connect(this.url);
    this.connection = conn;
    conn.on("error", (err: Error) => {
      console.error("[WebhookRabbitMQ] connection error:", err.message);
    });

    const pub = await conn.createConfirmChannel();
    await pub.assertExchange(WEBHOOK_EXCHANGE, "direct", { durable: true });
    await pub.assertQueue(OUTBOX_DELIVERY_QUEUE, { durable: true });
    await pub.bindQueue(
      OUTBOX_DELIVERY_QUEUE,
      WEBHOOK_EXCHANGE,
      OUTBOX_DELIVERY_ROUTING_KEY,
    );
    this.publishChannel = pub;
  }

  /**
   * Publikacja po commicie outboxa — `persistent: true`, potwierdzenie brokera.
   */
  async publishOutboxDelivery(outboxId: string): Promise<void> {
    if (this.closing || this.publishChannel === null) {
      throw new Error("Webhook RabbitMQ: kanał publikacji niedostępny");
    }
    const ch = this.publishChannel;
    const body = Buffer.from(
      JSON.stringify({ outboxId } satisfies OutboxDeliveryPayload),
    );
    return new Promise<void>((resolve, reject) => {
      const tryPublish = (): void => {
        const written = ch.publish(
          WEBHOOK_EXCHANGE,
          OUTBOX_DELIVERY_ROUTING_KEY,
          body,
          { persistent: true },
        (err: unknown) => {
          if (err != null) {
            reject(err);
          } else {
            resolve();
          }
        },
        );
        if (!written) {
          ch.once("drain", tryPublish);
        }
      };
      tryPublish();
    });
  }

  /**
   * Skrót zgodny ze specyfikacją: `publish('outbox_delivery', { outboxId })`.
   */
  async publish(
    routingKey: string,
    payload: OutboxDeliveryPayload,
  ): Promise<void> {
    if (routingKey !== OUTBOX_DELIVERY_ROUTING_KEY) {
      throw new Error(`Nieobsługiwany routing key webhooków: ${routingKey}`);
    }
    return this.publishOutboxDelivery(payload.outboxId);
  }

  /**
   * Konsument na `outbox_delivery`. Po udanym `handler` — ack; przy wyjątku — nack z requeue.
   */
  async startConsuming(
    handler: (outboxId: string) => Promise<void>,
  ): Promise<void> {
    if (this.connection === null || this.closing) {
      throw new Error("Webhook RabbitMQ: brak połączenia");
    }
    if (this.consumerChannel !== null) {
      throw new Error("Webhook RabbitMQ: konsument już uruchomiony");
    }

    const ch = await this.connection.createChannel();
    this.consumerChannel = ch;
    await ch.assertQueue(OUTBOX_DELIVERY_QUEUE, { durable: true });
    await ch.prefetch(10);

    const { consumerTag } = await ch.consume(
      OUTBOX_DELIVERY_QUEUE,
      (msg: ConsumeMessage | null) => {
        void (async () => {
          if (msg === null) {
            return;
          }
          try {
            const parsed: unknown = JSON.parse(msg.content.toString());
            const outboxId =
              parsed !== null &&
              typeof parsed === "object" &&
              "outboxId" in parsed &&
              typeof (parsed as { outboxId: unknown }).outboxId === "string"
                ? (parsed as { outboxId: string }).outboxId
                : null;
            if (outboxId === null) {
              ch.ack(msg);
              return;
            }
            await handler(outboxId);
            ch.ack(msg);
          } catch (e: unknown) {
            const m = e instanceof Error ? e.message : String(e);
            console.error("[WebhookRabbitMQ] consumer:", m);
            ch.nack(msg, false, true);
          }
        })();
      },
      { noAck: false },
    );
    this.consumerTag = consumerTag;
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;

    const tag = this.consumerTag;
    const pub = this.publishChannel;
    const cons = this.consumerChannel;
    const conn = this.connection;

    this.consumerTag = null;
    this.publishChannel = null;
    this.consumerChannel = null;
    this.connection = null;

    try {
      if (cons !== null && tag !== null) {
        await cons.cancel(tag);
      }
    } catch {
      /* ignore */
    }

    try {
      if (cons !== null) {
        await cons.close();
      }
    } catch {
      /* ignore */
    }

    try {
      if (pub !== null) {
        await pub.close();
      }
    } catch {
      /* ignore */
    }

    try {
      if (conn !== null) {
        await conn.close();
      }
    } catch {
      /* ignore */
    }
  }
}
