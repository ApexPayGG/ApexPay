import { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";
/**
 * Stub dla CI / dev bez RabbitMQ — nie wymaga brokera.
 */
export class NoOpMessageBroker {
    async publish(_routingKey, _payload) { }
    async close() { }
}
export { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";
export function createMessageBroker() {
    const url = process.env.RABBITMQ_URL?.trim();
    if (url === undefined || url.length === 0) {
        return new NoOpMessageBroker();
    }
    const exchange = process.env.RABBITMQ_EXCHANGE?.trim() ?? "apexpay.events";
    return new RabbitMqConnectionManager({ url, exchangeName: exchange });
}
//# sourceMappingURL=message-broker.js.map