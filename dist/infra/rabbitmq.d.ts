/** Exchange typu direct dla webhooków (osobny od `apexpay.events` używanego przy settlement). */
export declare const WEBHOOK_EXCHANGE = "apexpay.webhooks";
export declare const OUTBOX_DELIVERY_QUEUE = "outbox_delivery";
/** Routing key zgodny z nazwą kolejki (direct exchange). */
export declare const OUTBOX_DELIVERY_ROUTING_KEY = "outbox_delivery";
export type OutboxDeliveryPayload = {
    outboxId: string;
};
/**
 * Połączenie RabbitMQ wyłącznie dla kolejki outbox webhooków.
 * Publikacja przez confirm channel; konsumpcja na osobnym kanale.
 */
export declare class ApexpayWebhookRabbitMq {
    private readonly url;
    private connection;
    private publishChannel;
    private consumerChannel;
    private consumerTag;
    private closing;
    private constructor();
    static connect(url: string): Promise<ApexpayWebhookRabbitMq>;
    private init;
    /**
     * Publikacja po commicie outboxa — `persistent: true`, potwierdzenie brokera.
     */
    publishOutboxDelivery(outboxId: string): Promise<void>;
    /**
     * Skrót zgodny ze specyfikacją: `publish('outbox_delivery', { outboxId })`.
     */
    publish(routingKey: string, payload: OutboxDeliveryPayload): Promise<void>;
    /**
     * Konsument na `outbox_delivery`. Po udanym `handler` — ack; przy wyjątku — nack z requeue.
     */
    startConsuming(handler: (outboxId: string) => Promise<void>): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=rabbitmq.d.ts.map