import { connect, } from "amqplib";
/** Exchange typu direct dla webhooków (osobny od `apexpay.events` używanego przy settlement). */
export const WEBHOOK_EXCHANGE = "apexpay.webhooks";
export const OUTBOX_DELIVERY_QUEUE = "outbox_delivery";
/** Routing key zgodny z nazwą kolejki (direct exchange). */
export const OUTBOX_DELIVERY_ROUTING_KEY = "outbox_delivery";
/**
 * Połączenie RabbitMQ wyłącznie dla kolejki outbox webhooków.
 * Publikacja przez confirm channel; konsumpcja na osobnym kanale.
 */
export class ApexpayWebhookRabbitMq {
    url;
    connection = null;
    publishChannel = null;
    consumerChannel = null;
    consumerTag = null;
    closing = false;
    constructor(url) {
        this.url = url;
    }
    static async connect(url) {
        const inst = new ApexpayWebhookRabbitMq(url);
        await inst.init();
        return inst;
    }
    async init() {
        const conn = await connect(this.url);
        this.connection = conn;
        conn.on("error", (err) => {
            console.error("[WebhookRabbitMQ] connection error:", err.message);
        });
        const pub = await conn.createConfirmChannel();
        await pub.assertExchange(WEBHOOK_EXCHANGE, "direct", { durable: true });
        await pub.assertQueue(OUTBOX_DELIVERY_QUEUE, { durable: true });
        await pub.bindQueue(OUTBOX_DELIVERY_QUEUE, WEBHOOK_EXCHANGE, OUTBOX_DELIVERY_ROUTING_KEY);
        this.publishChannel = pub;
    }
    /**
     * Publikacja po commicie outboxa — `persistent: true`, potwierdzenie brokera.
     */
    async publishOutboxDelivery(outboxId) {
        if (this.closing || this.publishChannel === null) {
            throw new Error("Webhook RabbitMQ: kanał publikacji niedostępny");
        }
        const ch = this.publishChannel;
        const body = Buffer.from(JSON.stringify({ outboxId }));
        return new Promise((resolve, reject) => {
            const tryPublish = () => {
                const written = ch.publish(WEBHOOK_EXCHANGE, OUTBOX_DELIVERY_ROUTING_KEY, body, { persistent: true }, (err) => {
                    if (err != null) {
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
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
    async publish(routingKey, payload) {
        if (routingKey !== OUTBOX_DELIVERY_ROUTING_KEY) {
            throw new Error(`Nieobsługiwany routing key webhooków: ${routingKey}`);
        }
        return this.publishOutboxDelivery(payload.outboxId);
    }
    /**
     * Konsument na `outbox_delivery`. Po udanym `handler` — ack; przy wyjątku — nack z requeue.
     */
    async startConsuming(handler) {
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
        const { consumerTag } = await ch.consume(OUTBOX_DELIVERY_QUEUE, (msg) => {
            void (async () => {
                if (msg === null) {
                    return;
                }
                try {
                    const parsed = JSON.parse(msg.content.toString());
                    const outboxId = parsed !== null &&
                        typeof parsed === "object" &&
                        "outboxId" in parsed &&
                        typeof parsed.outboxId === "string"
                        ? parsed.outboxId
                        : null;
                    if (outboxId === null) {
                        ch.ack(msg);
                        return;
                    }
                    await handler(outboxId);
                    ch.ack(msg);
                }
                catch (e) {
                    const m = e instanceof Error ? e.message : String(e);
                    console.error("[WebhookRabbitMQ] consumer:", m);
                    ch.nack(msg, false, true);
                }
            })();
        }, { noAck: false });
        this.consumerTag = consumerTag;
    }
    async close() {
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
        }
        catch {
            /* ignore */
        }
        try {
            if (cons !== null) {
                await cons.close();
            }
        }
        catch {
            /* ignore */
        }
        try {
            if (pub !== null) {
                await pub.close();
            }
        }
        catch {
            /* ignore */
        }
        try {
            if (conn !== null) {
                await conn.close();
            }
        }
        catch {
            /* ignore */
        }
    }
}
//# sourceMappingURL=rabbitmq.js.map