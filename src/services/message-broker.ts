import { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";

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
export class NoOpMessageBroker implements MessageBroker {
  async publish(_routingKey: string, _payload: unknown): Promise<void> {}

  async close(): Promise<void> {}
}

export type { RabbitMqConnectionManagerOptions } from "./rabbitmq-connection.manager.js";
export { RabbitMqConnectionManager } from "./rabbitmq-connection.manager.js";

export function createMessageBroker(): MessageBroker {
  const url = process.env.RABBITMQ_URL?.trim();
  if (url === undefined || url.length === 0) {
    return new NoOpMessageBroker();
  }
  const exchange =
    process.env.RABBITMQ_EXCHANGE?.trim() ?? "apexpay.events";
  return new RabbitMqConnectionManager({ url, exchangeName: exchange });
}
