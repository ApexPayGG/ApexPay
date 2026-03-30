import { EventEmitter } from "node:events";
import { connect, } from "amqplib";
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 30_000;
/**
 * Jedno połączenie + jeden confirm channel do publikacji (publisher confirms).
 * Automatyczny reconnect z exponential backoff — błędy połączenia nie ubijają procesu Node.
 * Zdarzenie `reconnected` — po każdym udanym `connect` i przypisaniu połączenia (self-healing).
 */
export class RabbitMqConnectionManager extends EventEmitter {
    /** Wynik `connect()` — ChannelModel (amqplib); nie mylić z typem `Connection`. */
    connection = null;
    confirmChannel = null;
    reconnectTimer = null;
    closing = false;
    connecting = false;
    attempt = 0;
    url;
    exchangeName;
    exchangeType;
    initialBackoffMs;
    maxBackoffMs;
    publishConfirmTimeoutMs;
    constructor(options) {
        super();
        this.url = options.url;
        this.exchangeName = options.exchangeName;
        this.exchangeType = options.exchangeType ?? "topic";
        this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
        this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
        this.publishConfirmTimeoutMs =
            options.publishConfirmTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
        void this.establishConnection();
    }
    /** True gdy mamy kanał potwierdzeń gotowy do publish. */
    isReady() {
        return this.confirmChannel !== null && !this.closing;
    }
    /**
     * Czeka na pierwsze działające połączenie (publisher + exchange).
     * Potrzebne przed `createConsumerChannel()`.
     */
    async waitForReady(timeoutMs = 60_000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (this.closing) {
                throw new Error("RabbitMQ: zamykane");
            }
            if (this.connection !== null && this.confirmChannel !== null) {
                return;
            }
            await new Promise((r) => setImmediate(r));
        }
        throw new Error(`RabbitMQ: timeout oczekiwania na połączenie (${timeoutMs}ms)`);
    }
    /** Osobny kanał (nie confirm) do konsumentów — prefetch / ack / nack. */
    async createConsumerChannel() {
        await this.waitForReady();
        const conn = this.connection;
        if (conn === null || this.closing) {
            throw new Error("RabbitMQ: brak połączenia do kanału konsumenta");
        }
        return conn.createChannel();
    }
    async publish(routingKey, payload) {
        const ch = this.confirmChannel;
        if (ch === null || this.closing) {
            throw new Error("RabbitMQ: brak aktywnego kanału potwierdzeń");
        }
        const body = Buffer.from(JSON.stringify(payload));
        const exchange = this.exchangeName;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`RabbitMQ: timeout potwierdzenia publikacji (${this.publishConfirmTimeoutMs}ms)`));
            }, this.publishConfirmTimeoutMs);
            const send = () => {
                try {
                    const written = ch.publish(exchange, routingKey, body, { persistent: true }, (err) => {
                        clearTimeout(timeout);
                        if (err != null) {
                            reject(err instanceof Error ? err : new Error(String(err)));
                            return;
                        }
                        resolve();
                    });
                    if (!written) {
                        ch.once("drain", send);
                    }
                }
                catch (e) {
                    clearTimeout(timeout);
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            };
            send();
        });
    }
    async close() {
        this.closing = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const ch = this.confirmChannel;
        this.confirmChannel = null;
        if (ch !== null) {
            try {
                await ch.close();
            }
            catch {
                /* ignore */
            }
        }
        const conn = this.connection;
        this.connection = null;
        if (conn !== null) {
            try {
                await conn.close();
            }
            catch {
                /* ignore */
            }
        }
    }
    scheduleReconnect() {
        if (this.closing) {
            return;
        }
        if (this.reconnectTimer !== null) {
            return;
        }
        const exp = Math.min(this.initialBackoffMs * Math.pow(2, Math.min(this.attempt, 24)), this.maxBackoffMs);
        this.attempt += 1;
        console.warn(`[RabbitMQ] ponowne połączenie za ${Math.round(exp)}ms (próba ${this.attempt})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.establishConnection();
        }, exp);
    }
    async establishConnection() {
        if (this.closing) {
            return;
        }
        if (this.connecting) {
            return;
        }
        this.connecting = true;
        let conn = null;
        try {
            conn = await connect(this.url);
            conn.on("error", (err) => {
                console.error("[RabbitMQ] błąd połączenia:", err.message);
            });
            conn.on("close", () => {
                if (this.closing) {
                    return;
                }
                console.warn("[RabbitMQ] połączenie zamknięte");
                this.confirmChannel = null;
                this.connection = null;
                this.scheduleReconnect();
            });
            const ch = await conn.createConfirmChannel();
            await ch.assertExchange(this.exchangeName, this.exchangeType, {
                durable: true,
            });
            this.connection = conn;
            this.confirmChannel = ch;
            conn = null;
            this.attempt = 0;
            this.emit("reconnected", this.connection);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[RabbitMQ] nie udało się połączyć:", msg);
            this.confirmChannel = null;
            this.connection = null;
            if (conn !== null) {
                try {
                    await conn.close();
                }
                catch {
                    /* ignore */
                }
            }
            this.scheduleReconnect();
        }
        finally {
            this.connecting = false;
        }
    }
}
//# sourceMappingURL=rabbitmq-connection.manager.js.map