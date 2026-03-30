const DEFAULT_EXCHANGE = "apexpay.events";
const DLQ_QUEUE = "apexpay.events.dlq";
const SETTLEMENT_QUEUE = "apexpay.events.settlement_queue";
const ROUTING_KEY_FUNDS_SETTLED = "FUNDS_SETTLED";
/**
 * Konsument FUNDS_SETTLED: kolejka z DLQ (nack → apexpay.events.dlq).
 * Nasłuchuje `reconnected` managera (jeden listener na cały cykl życia do stop()).
 */
export class SettlementEventConsumerService {
    rabbit;
    options;
    channel = null;
    consumerTag = null;
    started = false;
    /** Kolejka serializująca odbudowy po reconnect (bez nakładania się). */
    rebuildTail = Promise.resolve();
    /** Referencja stabilna — jedna rejestracja `on`, usuwanie w `stop()`. */
    onReconnected = () => {
        this.rebuildTail = this.rebuildTail
            .then(async () => {
            await this.handleReconnectedAfterBrokerReconnect();
        })
            .catch((err) => {
            const m = err instanceof Error ? err.message : String(err);
            console.error("[SettlementConsumer] błąd odbudowy kanału po reconnected:", m);
        });
    };
    constructor(rabbit, options = {}) {
        this.rabbit = rabbit;
        this.options = options;
        this.rabbit.on("reconnected", this.onReconnected);
    }
    async start() {
        if (this.started) {
            return;
        }
        await this.rabbit.waitForReady();
        await this.setupConsumerChannel();
        this.started = true;
    }
    async handleReconnectedAfterBrokerReconnect() {
        if (!this.started) {
            return;
        }
        console.info("Odtwarzanie kanału konsumenta po restarcie połączenia RabbitMQ...");
        await this.closeConsumerChannelOnly();
        await this.rabbit.waitForReady();
        await this.setupConsumerChannel();
    }
    async setupConsumerChannel() {
        const exchange = this.options.exchangeName?.trim() ||
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
            const { consumerTag } = await ch.consume(SETTLEMENT_QUEUE, (msg) => {
                void this.dispatchMessage(ch, msg);
            }, { noAck: false });
            this.consumerTag = consumerTag;
            this.channel = ch;
        }
        catch (err) {
            try {
                await ch.close();
            }
            catch {
                /* ignore */
            }
            throw err;
        }
    }
    async closeConsumerChannelOnly() {
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
            }
            catch {
                /* ignore — kanał mógł być już zamknięty przez brokera */
            }
        }
        try {
            await ch.close();
        }
        catch {
            /* ignore */
        }
    }
    async dispatchMessage(ch, msg) {
        if (msg === null) {
            return;
        }
        try {
            const raw = msg.content.toString();
            const payload = JSON.parse(raw);
            await new Promise((r) => setTimeout(r, 100));
            console.log("Powiadomienie wysłane dla meczu:", payload.matchId ?? "(brak matchId)");
            ch.ack(msg);
        }
        catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            console.error("[SettlementConsumer] przetwarzanie nie powiodło się:", m);
            ch.nack(msg, false, false);
        }
    }
    async stop() {
        await this.rebuildTail.catch(() => { });
        this.rabbit.removeListener("reconnected", this.onReconnected);
        await this.closeConsumerChannelOnly();
        this.started = false;
    }
}
//# sourceMappingURL=settlement-event-consumer.service.js.map