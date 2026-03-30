import CircuitBreaker from "opossum";
import { type PrismaClient } from "@prisma/client";
import type { MessageBroker } from "./message-broker.js";
export type OutboxPollerOptions = {
    intervalMs?: number;
    maxRetries?: number;
    /** Testy / zaawansowane — wstrzyknięty breaker zamiast domyślnego. */
    circuitBreaker?: CircuitBreaker<[string, unknown], void>;
};
export declare class OutboxPollerService {
    private readonly prisma;
    private readonly broker;
    private readonly options;
    private timer;
    private readonly publishBreaker;
    constructor(prisma: PrismaClient, broker: MessageBroker, options?: OutboxPollerOptions);
    private attachPublishBreakerListeners;
    start(): void;
    stop(): void;
    /**
     * Jedna iteracja pętli (testy + jawne wywołanie).
     */
    pollOnce(): Promise<void>;
    private processRow;
}
//# sourceMappingURL=outbox-poller.service.d.ts.map