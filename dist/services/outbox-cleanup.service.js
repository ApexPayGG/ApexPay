import { Prisma } from "@prisma/client";
import cron from "node-cron";
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_DELAY_MS = 100;
/** Codziennie o 03:00 czasu serwera. */
const CRON_AT_03_00 = "0 3 * * *";
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
export class OutboxCleanupService {
    prisma;
    options;
    scheduledTask = null;
    constructor(prisma, options = {}) {
        this.prisma = prisma;
        this.options = options;
    }
    /**
     * Harmonogram: codziennie 03:00 (node-cron, czas lokalny procesu).
     */
    start() {
        if (this.scheduledTask !== null) {
            return;
        }
        this.scheduledTask = cron.schedule(CRON_AT_03_00, () => {
            void this.runCleanup();
        });
    }
    /**
     * Zatrzymuje cron (graceful shutdown).
     */
    stop() {
        if (this.scheduledTask !== null) {
            this.scheduledTask.stop();
            this.scheduledTask = null;
        }
    }
    /**
     * Jednorazowe uruchomienie retencji (testy / ręczne wywołanie).
     */
    async runCleanup() {
        const started = Date.now();
        const retentionDays = this.options.retentionDays ?? DEFAULT_RETENTION_DAYS;
        const chunkSize = this.options.chunkSize ?? DEFAULT_CHUNK_SIZE;
        const chunkDelayMs = this.options.chunkDelayMs ?? DEFAULT_CHUNK_DELAY_MS;
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        let chunksProcessed = 0;
        let rowsDeleted = 0;
        try {
            for (;;) {
                const deleted = await this.deleteOneChunk(cutoff, chunkSize);
                if (deleted === 0) {
                    break;
                }
                chunksProcessed += 1;
                rowsDeleted += deleted;
                if (chunkDelayMs > 0) {
                    await sleep(chunkDelayMs);
                }
            }
            const durationMs = Date.now() - started;
            console.info(JSON.stringify({
                event: "outbox_cleanup_completed",
                chunksProcessed,
                rowsDeleted,
                durationMs,
                retentionDays,
                chunkSize,
                at: new Date().toISOString(),
            }));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(JSON.stringify({
                event: "outbox_cleanup_failed",
                error: msg,
                at: new Date().toISOString(),
            }));
        }
    }
    async deleteOneChunk(cutoff, limit) {
        const result = await this.prisma.$executeRaw(Prisma.sql `
        DELETE FROM "OutboxEvent"
        WHERE id IN (
          SELECT id FROM "OutboxEvent"
          WHERE status = 'PROCESSED'
            AND COALESCE("updated_at", "created_at") < ${cutoff}
          LIMIT ${limit}
        )
      `);
        return typeof result === "bigint" ? Number(result) : Number(result);
    }
}
//# sourceMappingURL=outbox-cleanup.service.js.map