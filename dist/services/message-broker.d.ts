/**
 * Kontrakt brokera wiadomości — łatwy do mockowania w Vitest (`vi.fn()`).
 */
export interface MessageBroker {
    publish(routingKey: string, payload: unknown): Promise<void>;
    close(): Promise<void>;
}
/**
 * Stub dla CI / dev bez RabbitMQ — nie wymaga brokera.
 */
export declare class NoOpMessageBroker implements MessageBroker {
    publish(_routingKey: string, _payload: unknown): Promise<void>;
    close(): Promise<void>;
}
export type { RabbitMqConnectionManagerOptions } from "./rabbitmq-connection.manager.js";
export { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";
export declare function createMessageBroker(): MessageBroker;
//# sourceMappingURL=message-broker.d.ts.map