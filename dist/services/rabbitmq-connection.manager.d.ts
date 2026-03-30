import { EventEmitter } from "node:events";
import { type Channel } from "amqplib";
export type RabbitMqConnectionManagerOptions = {
    url: string;
    /** Domyślnie topic — routing key = eventType z outboxa. */
    exchangeName: string;
    exchangeType?: "topic" | "direct" | "fanout";
    /** Bazowy odstęp przed pierwszym ponownym połączeniem (ms). */
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    /** Timeout na potwierdzenie publikacji (ACK brokera). */
    publishConfirmTimeoutMs?: number;
};
/**
 * Jedno połączenie + jeden confirm channel do publikacji (publisher confirms).
 * Automatyczny reconnect z exponential backoff — błędy połączenia nie ubijają procesu Node.
 * Zdarzenie `reconnected` — po każdym udanym `connect` i przypisaniu połączenia (self-healing).
 */
export declare class RabbitMqConnectionManager extends EventEmitter {
    /** Wynik `connect()` — ChannelModel (amqplib); nie mylić z typem `Connection`. */
    private connection;
    private confirmChannel;
    private reconnectTimer;
    private closing;
    private connecting;
    private attempt;
    private readonly url;
    private readonly exchangeName;
    private readonly exchangeType;
    private readonly initialBackoffMs;
    private readonly maxBackoffMs;
    private readonly publishConfirmTimeoutMs;
    constructor(options: RabbitMqConnectionManagerOptions);
    /** True gdy mamy kanał potwierdzeń gotowy do publish. */
    isReady(): boolean;
    /**
     * Czeka na pierwsze działające połączenie (publisher + exchange).
     * Potrzebne przed `createConsumerChannel()`.
     */
    waitForReady(timeoutMs?: number): Promise<void>;
    /** Osobny kanał (nie confirm) do konsumentów — prefetch / ack / nack. */
    createConsumerChannel(): Promise<Channel>;
    publish(routingKey: string, payload: unknown): Promise<void>;
    close(): Promise<void>;
    private scheduleReconnect;
    private establishConnection;
}
//# sourceMappingURL=rabbitmq-connection.manager.d.ts.map