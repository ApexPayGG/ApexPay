import { type PrismaClient } from "@prisma/client";
import type { ApexpayWebhookRabbitMq } from "../infra/rabbitmq.js";
/** Eksportowane do testów (zsynchronizuj z logiką retry → dead letter). */
export declare const MAX_DELIVERY_ATTEMPTS = 5;
/** Opóźnienie kolejnej próby po nieudanej dostawie (`attempts` już po inkrementacji). */
export declare function webhookRetryDelayMs(attemptsAfterFailure: number): number;
export declare function signWebhookPayloadBody(bodyUtf8: string, webhookSecret: string): string;
/** Porównanie sygnatur w sposób odporny na timing attacks (długość musi się zgadzać). */
export declare function verifyWebhookSignature(bodyUtf8: string, webhookSecret: string, signatureHex: string): boolean;
export type WebhookDispatcherOptions = {
    batchSize?: number;
    fetchImpl?: typeof fetch;
    requestTimeoutMs?: number;
};
export declare class WebhookDispatcherService {
    private readonly prisma;
    private readonly batchSize;
    private readonly fetchImpl;
    private readonly requestTimeoutMs;
    constructor(prisma: PrismaClient, options?: WebhookDispatcherOptions);
    /**
     * Zawieszone PROCESSING (worker padł) — wracają do kolejki jako FAILED z natychmiastowym `nextAttemptAt`.
     */
    private reclaimStaleProcessing;
    processPendingWebhooks(): Promise<void>;
    /**
     * Pojedynczy wpis z kolejki RabbitMQ: claim (PENDING/FAILED + nextAttemptAt),
     * potem ta sama ścieżka co worker wsadowy. Brak claimu → no-op (ack po stronie konsumenta;
     * retry przez `nextAttemptAt` obsłuży interwał lub kolejna wiadomość).
     */
    processOutboxById(outboxId: string): Promise<void>;
    startConsumer(broker: ApexpayWebhookRabbitMq): Promise<void>;
    private deliverOne;
}
//# sourceMappingURL=webhook-dispatcher.service.d.ts.map