import CircuitBreaker from "opossum";
import { Prisma } from "@prisma/client";
import { messageBrokerPublishErrorsTotal, outboxPendingEventsTotal, } from "../monitoring/metrics.js";
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_RETRIES = 5;
const PUBLISH_BREAKER_OPTIONS = {
    errorThresholdPercentage: 50,
    volumeThreshold: 10,
    resetTimeout: 30_000,
    rollingCountTimeout: 10_000,
};
const SELECT_PENDING_FOR_UPDATE = Prisma.sql `
  SELECT * FROM "OutboxEvent"
  WHERE status = 'PENDING'
  ORDER BY created_at ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED
`;
export class OutboxPollerService {
    prisma;
    broker;
    options;
    timer = null;
    publishBreaker;
    constructor(prisma, broker, options = {}) {
        this.prisma = prisma;
        this.broker = broker;
        this.options = options;
        this.publishBreaker =
            options.circuitBreaker ??
                new CircuitBreaker((routingKey, payload) => this.broker.publish(routingKey, payload), PUBLISH_BREAKER_OPTIONS);
        this.attachPublishBreakerListeners();
    }
    attachPublishBreakerListeners() {
        this.publishBreaker.on("open", () => {
            console.warn("[OutboxPoller] Circuit breaker: OPEN — pomijanie odczytu outboxa (FOR UPDATE SKIP LOCKED) do czasu resetu.");
        });
        this.publishBreaker.on("halfOpen", () => {
            console.warn("[OutboxPoller] Circuit breaker: HALF_OPEN — pojedyncza próba odzyskania.");
        });
        this.publishBreaker.on("close", () => {
            console.warn("[OutboxPoller] Circuit breaker: CLOSED — normalna praca.");
        });
    }
    start() {
        if (this.timer !== null) {
            return;
        }
        const ms = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
        this.timer = setInterval(() => {
            void this.pollOnce();
        }, ms);
    }
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (!this.publishBreaker.isShutdown) {
            this.publishBreaker.shutdown();
        }
    }
    /**
     * Jedna iteracja pętli (testy + jawne wywołanie).
     */
    async pollOnce() {
        if (this.publishBreaker.opened) {
            return;
        }
        try {
            const rows = await this.prisma.$transaction(async (tx) => {
                const locked = await tx.$queryRaw(SELECT_PENDING_FOR_UPDATE);
                outboxPendingEventsTotal.set(locked.length);
                if (locked.length === 0) {
                    return [];
                }
                const ids = locked.map((r) => r.id);
                await tx.outboxEvent.updateMany({
                    where: { id: { in: ids } },
                    data: { status: "PROCESSING" },
                });
                return locked;
            });
            for (const row of rows) {
                await this.processRow(row);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[OutboxPoller] tick failed:", msg);
        }
    }
    async processRow(row) {
        try {
            await this.publishBreaker.fire(row.eventType, row.payload);
            await this.prisma.outboxEvent.update({
                where: { id: row.id },
                data: { status: "PROCESSED" },
            });
        }
        catch (err) {
            messageBrokerPublishErrorsTotal.inc();
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[OutboxPoller] publish failed:", row.id, msg);
            const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
            const nextRetry = row.retryCount + 1;
            if (nextRetry >= maxRetries) {
                await this.prisma.outboxEvent.update({
                    where: { id: row.id },
                    data: { status: "FAILED", retryCount: nextRetry },
                });
            }
            else {
                await this.prisma.outboxEvent.update({
                    where: { id: row.id },
                    data: { status: "PENDING", retryCount: nextRetry },
                });
            }
        }
    }
}
//# sourceMappingURL=outbox-poller.service.js.map