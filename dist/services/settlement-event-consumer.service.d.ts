import type { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";
export type SettlementEventConsumerOptions = {
    /** Domyślnie env `RABBITMQ_EXCHANGE` lub `apexpay.events`. */
    exchangeName?: string;
};
/**
 * Konsument FUNDS_SETTLED: kolejka z DLQ (nack → apexpay.events.dlq).
 * Nasłuchuje `reconnected` managera (jeden listener na cały cykl życia do stop()).
 */
export declare class SettlementEventConsumerService {
    private readonly rabbit;
    private readonly options;
    private channel;
    private consumerTag;
    private started;
    /** Kolejka serializująca odbudowy po reconnect (bez nakładania się). */
    private rebuildTail;
    /** Referencja stabilna — jedna rejestracja `on`, usuwanie w `stop()`. */
    private readonly onReconnected;
    constructor(rabbit: RabbitMqConnectionManager, options?: SettlementEventConsumerOptions);
    start(): Promise<void>;
    private handleReconnectedAfterBrokerReconnect;
    private setupConsumerChannel;
    private closeConsumerChannelOnly;
    private dispatchMessage;
    stop(): Promise<void>;
}
//# sourceMappingURL=settlement-event-consumer.service.d.ts.map