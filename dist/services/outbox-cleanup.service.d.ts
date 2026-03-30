import { type PrismaClient } from "@prisma/client";
export type OutboxCleanupOptions = {
    retentionDays?: number;
    chunkSize?: number;
    chunkDelayMs?: number;
};
export declare class OutboxCleanupService {
    private readonly prisma;
    private readonly options;
    private scheduledTask;
    constructor(prisma: PrismaClient, options?: OutboxCleanupOptions);
    /**
     * Harmonogram: codziennie 03:00 (node-cron, czas lokalny procesu).
     */
    start(): void;
    /**
     * Zatrzymuje cron (graceful shutdown).
     */
    stop(): void;
    /**
     * Jednorazowe uruchomienie retencji (testy / ręczne wywołanie).
     */
    runCleanup(): Promise<void>;
    private deleteOneChunk;
}
//# sourceMappingURL=outbox-cleanup.service.d.ts.map