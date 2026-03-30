import type { Channel, ConsumeMessage } from "amqplib";
import type { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";

const DEFAULT_EXCHANGE = "apexpay.events";
const DLQ_QUEUE = "apexpay.events.dlq";
const SETTLEMENT_QUEUE = "apexpay.events.settlement_queue";
const ROUTING_KEY_FUNDS_SETTLED = "FUNDS_SETTLED";

export type SettlementEventConsumerOptions = {
  /** Domyślnie env `RABBITMQ_EXCHANGE` lub `apexpay.events`. */
  exchangeName?: string;
};

/**
 * Konsument FUNDS_SETTLED: kolejka z DLQ (nack → apexpay.events.dlq).
 * Nasłuchuje `reconnected` managera (jeden listener na cały cykl życia do stop()).
 */
export class SettlementEventConsumerService {
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private started = false;
  /** Kolejka serializująca odbudowy po reconnect (bez nakładania się). */
  private rebuildTail: Promise<void> = Promise.resolve();

  /** Referencja stabilna — jedna rejestracja `on`, usuwanie w `stop()`. */
  private readonly onReconnected = (): void => {
    this.rebuildTail = this.rebuildTail
      .then(async () => {
        await this.handleReconnectedAfterBrokerReconnect();
      })
      .catch((err: unknown) => {
        const m = err instanceof Error ? err.message : String(err);
        console.error(
          "[SettlementConsumer] błąd odbudowy kanału po reconnected:",
          m,
        );
      });
  };

  constructor(
    private readonly rabbit: RabbitMqConnectionManager,
    private readonly options: SettlementEventConsumerOptions = {},
  ) {
    this.rabbit.on("reconnected", this.onReconnected);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    await this.rabbit.waitForReady();
    await this.setupConsumerChannel();
    this.started = true;
  }

  private async handleReconnectedAfterBrokerReconnect(): Promise<void> {
    if (!this.started) {
      return;
    }
    console.info(
      "Odtwarzanie kanału konsumenta po restarcie połączenia RabbitMQ...",
    );
    await this.closeConsumerChannelOnly();
    await this.rabbit.waitForReady();
    await this.setupConsumerChannel();
  }

  private async setupConsumerChannel(): Promise<void> {
    const exchange =
      this.options.exchangeName?.trim() ||
      process.env.RABBITMQ_EXCHANGE?.trim() ||
      DEFAULT_EXCHANGE;

    const ch = await this.rabbit.createConsumerChannel();

    try {
      await ch.assertExchange(exchange, "topic", { durable: true });
      await ch.assertQueue(DLQ_QUEUE, { durable: true });
      await ch.assertQueue(SETTLEMENT_QUEUE, {
        durable: true,
        deadLetterExchange: "",
        deadLetterRoutingKey: DLQ_QUEUE,
      });
      await ch.bindQueue(SETTLEMENT_QUEUE, exchange, ROUTING_KEY_FUNDS_SETTLED);
      await ch.prefetch(10);

      const { consumerTag } = await ch.consume(
        SETTLEMENT_QUEUE,
        (msg: ConsumeMessage | null) => {
          void this.dispatchMessage(ch, msg);
        },
        { noAck: false },
      );
      this.consumerTag = consumerTag;
      this.channel = ch;
    } catch (err: unknown) {
      try {
        await ch.close();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private async closeConsumerChannelOnly(): Promise<void> {
    const ch = this.channel;
    if (ch === null) {
      return;
    }
    const tag = this.consumerTag;
    this.channel = null;
    this.consumerTag = null;

    if (tag !== null) {
      try {
        await ch.cancel(tag);
      } catch {
        /* ignore — kanał mógł być już zamknięty przez brokera */
      }
    }

    try {
      await ch.close();
    } catch {
      /* ignore */
    }
  }

  private async dispatchMessage(
    ch: Channel,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    if (msg === null) {
      return;
    }
    try {
      const raw = msg.content.toString();
      const payload = JSON.parse(raw) as { matchId?: unknown };
      await new Promise<void>((r) => setTimeout(r, 100));
      console.log(
        "Powiadomienie wysłane dla meczu:",
        payload.matchId ?? "(brak matchId)",
      );
      ch.ack(msg);
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      console.error("[SettlementConsumer] przetwarzanie nie powiodło się:", m);
      ch.nack(msg, false, false);
    }
  }

  async stop(): Promise<void> {
    await this.rebuildTail.catch(() => {});
    this.rabbit.removeListener("reconnected", this.onReconnected);
    await this.closeConsumerChannelOnly();
    this.started = false;
  }
}
