import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, WebhookStatus } from "@prisma/client";
import { contextLogger, logger } from "../lib/logger.js";
import { runWithContext } from "../lib/request-context.js";
import { archiveWebhookOutboxToDeadLetter } from "./webhook-dead-letter.service.js";
/** Eksportowane do testów (zsynchronizuj z logiką retry → dead letter). */
export const MAX_DELIVERY_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const DEFAULT_BATCH = 25;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
/** Opóźnienie kolejnej próby po nieudanej dostawie (`attempts` już po inkrementacji). */
export function webhookRetryDelayMs(attemptsAfterFailure) {
    if (attemptsAfterFailure <= 1) {
        return 60_000;
    }
    if (attemptsAfterFailure === 2) {
        return 5 * 60_000;
    }
    return 60 * 60_000;
}
export function signWebhookPayloadBody(bodyUtf8, webhookSecret) {
    return createHmac("sha256", webhookSecret).update(bodyUtf8, "utf8").digest("hex");
}
/** Porównanie sygnatur w sposób odporny na timing attacks (długość musi się zgadzać). */
export function verifyWebhookSignature(bodyUtf8, webhookSecret, signatureHex) {
    const expected = signWebhookPayloadBody(bodyUtf8, webhookSecret);
    try {
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(signatureHex.trim(), "hex");
        if (a.length !== b.length) {
            return false;
        }
        return timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
export class WebhookDispatcherService {
    prisma;
    batchSize;
    fetchImpl;
    requestTimeoutMs;
    constructor(prisma, options = {}) {
        this.prisma = prisma;
        this.batchSize = options.batchSize ?? DEFAULT_BATCH;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    }
    /**
     * Zawieszone PROCESSING (worker padł) — wracają do kolejki jako FAILED z natychmiastowym `nextAttemptAt`.
     */
    async reclaimStaleProcessing(now) {
        const threshold = new Date(now.getTime() - STALE_PROCESSING_MS);
        await this.prisma.webhookOutbox.updateMany({
            where: {
                status: WebhookStatus.PROCESSING,
                updatedAt: { lt: threshold },
            },
            data: {
                status: WebhookStatus.FAILED,
                nextAttemptAt: now,
            },
        });
    }
    async processPendingWebhooks() {
        const now = new Date();
        try {
            await this.reclaimStaleProcessing(now);
            const claimed = await this.prisma.$transaction(async (tx) => {
                const candidates = await tx.webhookOutbox.findMany({
                    where: {
                        status: { in: [WebhookStatus.PENDING, WebhookStatus.FAILED] },
                        nextAttemptAt: { lte: now },
                    },
                    orderBy: { nextAttemptAt: "asc" },
                    take: this.batchSize,
                });
                const out = [];
                for (const c of candidates) {
                    const u = await tx.webhookOutbox.updateMany({
                        where: {
                            id: c.id,
                            status: { in: [WebhookStatus.PENDING, WebhookStatus.FAILED] },
                            nextAttemptAt: { lte: now },
                        },
                        data: { status: WebhookStatus.PROCESSING },
                    });
                    if (u.count === 1) {
                        out.push(c);
                    }
                }
                return out;
            });
            for (const row of claimed) {
                await runWithContext({ traceId: randomUUID() }, async () => {
                    await this.deliverOne(row);
                });
            }
        }
        catch (err) {
            logger.error({ err }, "[WebhookDispatcher] processPendingWebhooks");
        }
    }
    /**
     * Pojedynczy wpis z kolejki RabbitMQ: claim (PENDING/FAILED + nextAttemptAt),
     * potem ta sama ścieżka co worker wsadowy. Brak claimu → no-op (ack po stronie konsumenta;
     * retry przez `nextAttemptAt` obsłuży interwał lub kolejna wiadomość).
     */
    async processOutboxById(outboxId) {
        const row = await this.prisma.webhookOutbox.findUnique({
            where: { id: outboxId },
        });
        if (row === null || row.status === WebhookStatus.SUCCESS) {
            return;
        }
        const now = new Date();
        const claim = await this.prisma.webhookOutbox.updateMany({
            where: {
                id: outboxId,
                status: { in: [WebhookStatus.PENDING, WebhookStatus.FAILED] },
                nextAttemptAt: { lte: now },
            },
            data: { status: WebhookStatus.PROCESSING },
        });
        if (claim.count === 0) {
            return;
        }
        const fresh = await this.prisma.webhookOutbox.findUniqueOrThrow({
            where: { id: outboxId },
        });
        await this.deliverOne(fresh);
    }
    async startConsumer(broker) {
        await broker.startConsuming(async (outboxId) => {
            await runWithContext({ traceId: randomUUID() }, async () => {
                await this.processOutboxById(outboxId);
            });
        });
    }
    async deliverOne(row) {
        const config = await this.prisma.integratorConfig.findUnique({
            where: { userId: row.integratorUserId },
        });
        if (config === null || config.webhookUrl === null || config.webhookUrl.trim().length === 0) {
            contextLogger().warn({ outboxId: row.id, reason: "no_webhook_url" }, "Webhook: skipped (brak URL)");
            const lastError = "no_webhook_url";
            const lastAttemptAt = new Date();
            const { deadLetterId } = await archiveWebhookOutboxToDeadLetter(this.prisma, row, MAX_DELIVERY_ATTEMPTS, lastError, lastAttemptAt);
            contextLogger().error({
                deadLetterId,
                integratorUserId: row.integratorUserId,
                eventType: row.eventType,
                attempts: MAX_DELIVERY_ATTEMPTS,
                lastError,
            }, "Webhook: moved to dead letter queue");
            return;
        }
        const bodyString = JSON.stringify(row.payload);
        const signature = signWebhookPayloadBody(bodyString, config.webhookSecret);
        const url = config.webhookUrl.trim();
        const attemptNo = row.attempts + 1;
        contextLogger().info({ outboxId: row.id, attempt: attemptNo, webhookUrl: url }, "Webhook: delivery attempt");
        let httpOk = false;
        let lastError = "http_request_failed";
        try {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), this.requestTimeoutMs);
            const res = await this.fetchImpl(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-apexpay-signature": signature,
                },
                body: bodyString,
                signal: ac.signal,
            });
            clearTimeout(t);
            httpOk = res.ok;
            if (!res.ok) {
                lastError = `HTTP_${res.status}`;
            }
        }
        catch (e) {
            httpOk = false;
            lastError = e instanceof Error ? e.message : String(e);
        }
        if (httpOk) {
            contextLogger().info({ outboxId: row.id, webhookUrl: url }, "Webhook: delivery succeeded");
            await this.prisma.webhookOutbox.update({
                where: { id: row.id },
                data: { status: WebhookStatus.SUCCESS },
            });
            return;
        }
        const newAttempts = row.attempts + 1;
        if (newAttempts >= MAX_DELIVERY_ATTEMPTS) {
            const lastAttemptAt = new Date();
            const { deadLetterId } = await archiveWebhookOutboxToDeadLetter(this.prisma, row, newAttempts, lastError, lastAttemptAt);
            contextLogger().error({
                deadLetterId,
                integratorUserId: row.integratorUserId,
                eventType: row.eventType,
                attempts: newAttempts,
                lastError,
            }, "Webhook: moved to dead letter queue");
            return;
        }
        const delay = webhookRetryDelayMs(newAttempts);
        contextLogger().warn({
            outboxId: row.id,
            attempt: newAttempts,
            webhookUrl: url,
            nextRetryInMs: delay,
        }, "Webhook: delivery failed, scheduled retry");
        await this.prisma.webhookOutbox.update({
            where: { id: row.id },
            data: {
                status: WebhookStatus.FAILED,
                attempts: newAttempts,
                nextAttemptAt: new Date(Date.now() + delay),
            },
        });
    }
}
//# sourceMappingURL=webhook-dispatcher.service.js.map