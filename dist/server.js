import path from "node:path";
import "dotenv/config";
const requiredEnvs = ["DATABASE_URL", "JWT_SECRET"];
for (const env of requiredEnvs) {
    if (!process.env[env]) {
        console.error(`[FATAL] Missing strictly required environment variable: ${env}`);
        process.exit(1);
    }
}
import pg from "pg";
import { Redis } from "ioredis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./create-app.js";
import { ApexpayWebhookRabbitMq } from "./infra/rabbitmq.js";
import { register } from "./monitoring/metrics.js";
import { createMessageBroker, RabbitMqConnectionManager, } from "./services/message-broker.js";
import { OutboxCleanupService } from "./services/outbox-cleanup.service.js";
import { OutboxPollerService } from "./services/outbox-poller.service.js";
import { SettlementEventConsumerService } from "./services/settlement-event-consumer.service.js";
import { WebhookDispatcherService } from "./services/webhook-dispatcher.service.js";
import { AuditLogService } from "./services/audit-log.service.js";
import { DisputeService } from "./services/dispute.service.js";
import { FraudDetectionService } from "./services/fraud-detection.service.js";
import { contextLogger } from "./lib/logger.js";
async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.length === 0) {
        throw new Error("DATABASE_URL is required");
    }
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    const redis = new Redis(redisUrl);
    redis.on("error", (err) => {
        console.error("[Redis]", err.message, "— uruchom Redis (np. docker compose up -d redis).");
    });
    let webhookBroker = null;
    const rabbitUrl = process.env.RABBITMQ_URL?.trim();
    if (rabbitUrl !== undefined && rabbitUrl.length > 0) {
        try {
            webhookBroker = await ApexpayWebhookRabbitMq.connect(rabbitUrl);
            console.log("[WebhookRabbitMQ] Połączono (exchange apexpay.webhooks, kolejka outbox_delivery).");
        }
        catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error("[WebhookRabbitMQ] connect failed (tylko polling webhooków):", m);
        }
    }
    const webhookPublish = webhookBroker !== null
        ? (outboxId) => webhookBroker.publishOutboxDelivery(outboxId)
        : undefined;
    const { app, httpServer } = createApp({
        prisma,
        redis,
        ...(webhookPublish !== undefined ? { webhookPublish } : {}),
    });
    const auditLogForDisputeAlerts = new AuditLogService(prisma);
    const disputeServiceForAlerts = new DisputeService(prisma, redis, auditLogForDisputeAlerts);
    const DISPUTE_DEADLINE_ALERT_MS = 60 * 60 * 1000;
    const disputeDeadlineTimer = setInterval(() => {
        void (async () => {
            try {
                const rows = await disputeServiceForAlerts.findDisputesWithEvidenceDeadlineWithinHours(48);
                for (const d of rows) {
                    const hoursLeft = (d.evidenceDueBy.getTime() - Date.now()) / 3_600_000;
                    contextLogger().warn({
                        disputeId: d.id,
                        chargeId: d.chargeId,
                        evidenceDueBy: d.evidenceDueBy.toISOString(),
                        hoursLeft: Math.round(hoursLeft * 100) / 100,
                    }, "Dispute evidence deadline within 48h");
                }
                const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const deadLetterCount = await prisma.webhookDeadLetter.count({
                    where: {
                        requeued: false,
                        createdAt: { gte: since24h },
                    },
                });
                const dlThresholdRaw = process.env.DEAD_LETTER_ALERT_THRESHOLD;
                const deadLetterThreshold = Number(dlThresholdRaw !== undefined && dlThresholdRaw.trim() !== ""
                    ? dlThresholdRaw
                    : "10");
                const threshold = Number.isFinite(deadLetterThreshold) ? deadLetterThreshold : 10;
                if (deadLetterCount > threshold) {
                    contextLogger().warn({
                        deadLetterCount24hUnrequeued: deadLetterCount,
                        threshold,
                    }, "Webhook dead letters above threshold (24h, unrequeued)");
                }
            }
            catch (e) {
                contextLogger().error({ err: e instanceof Error ? e.message : String(e) }, "Hourly operational alert tick failed (disputes / dead letters)");
            }
        })();
    }, DISPUTE_DEADLINE_ALERT_MS);
    const fraudForAlerts = new FraudDetectionService(prisma, auditLogForDisputeAlerts);
    const FRAUD_FLAGGED_ALERT_MS = 5 * 60 * 1000;
    const fraudFlaggedTimer = setInterval(() => {
        void (async () => {
            try {
                const n = await fraudForAlerts.countUnreviewedFlaggedRecent(1);
                if (n > 0) {
                    contextLogger().warn({ unreviewedFlaggedCount: n }, "Fraud: nierozpatrzone FLAGGED (ostatnia 1h)");
                }
            }
            catch (e) {
                contextLogger().error({ err: e instanceof Error ? e.message : String(e) }, "Fraud flagged alert tick failed");
            }
        })();
    }, FRAUD_FLAGGED_ALERT_MS);
    app.get("/metrics", async (_req, res, next) => {
        try {
            res.setHeader("Content-Type", register.contentType);
            res.end(await register.metrics());
        }
        catch (err) {
            next(err);
        }
    });
    const messageBroker = createMessageBroker();
    let settlementConsumer = null;
    if (messageBroker instanceof RabbitMqConnectionManager) {
        settlementConsumer = new SettlementEventConsumerService(messageBroker);
        void settlementConsumer.start().catch((e) => {
            const m = e instanceof Error ? e.message : String(e);
            console.error("[SettlementConsumer] start failed:", m);
        });
    }
    const outboxPoller = new OutboxPollerService(prisma, messageBroker);
    outboxPoller.start();
    const outboxCleanup = new OutboxCleanupService(prisma);
    outboxCleanup.start();
    const webhookDispatcher = new WebhookDispatcherService(prisma);
    if (webhookBroker !== null) {
        /** Konsument `outbox_delivery`: każda wiadomość z własnym `traceId` (AsyncLocalStorage) — patrz `WebhookDispatcherService.startConsumer`. */
        void webhookDispatcher.startConsumer(webhookBroker).catch((e) => {
            const m = e instanceof Error ? e.message : String(e);
            console.error("[WebhookConsumer] start failed:", m);
        });
    }
    /** Zapasowy polling (np. brak wiadomości w RabbitMQ). */
    const WEBHOOK_DISPATCH_INTERVAL_MS = 60_000;
    const webhookDispatchTimer = setInterval(() => {
        void webhookDispatcher.processPendingWebhooks();
    }, WEBHOOK_DISPATCH_INTERVAL_MS);
    void webhookDispatcher.processPendingWebhooks();
    const PORT = Number(process.env.PORT) || 3000;
    const webUi = process.env.APEXPAY_WEB_UI_DIR?.trim();
    httpServer.listen(PORT, () => {
        console.log(`[ApexPay Core] Silnik gotowy na porcie ${PORT}`);
        console.log(`[ApexPay WS] Nasłuch WebSocket aktywny`);
        if (webUi !== undefined && webUi.length > 0) {
            console.log(`[ApexPay Web] UI statyczne: ${path.resolve(process.cwd(), webUi)} → http://localhost:${PORT}/`);
        }
    });
    async function shutdown(signal) {
        console.log(`[ApexPay] sygnał ${signal}, zamykanie…`);
        outboxPoller.stop();
        outboxCleanup.stop();
        clearInterval(webhookDispatchTimer);
        clearInterval(disputeDeadlineTimer);
        clearInterval(fraudFlaggedTimer);
        if (webhookBroker !== null) {
            try {
                await webhookBroker.close();
            }
            catch (e) {
                const m = e instanceof Error ? e.message : String(e);
                console.error("[WebhookRabbitMQ] close error:", m);
            }
        }
        if (settlementConsumer !== null) {
            try {
                await settlementConsumer.stop();
            }
            catch (e) {
                const m = e instanceof Error ? e.message : String(e);
                console.error("[SettlementConsumer] stop error:", m);
            }
        }
        try {
            await messageBroker.close();
        }
        catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error("[ApexPay] błąd zamykania brokera:", m);
        }
        await new Promise((resolve) => {
            httpServer.close(() => resolve());
        });
        await pool.end();
        await redis.quit();
        process.exit(0);
    }
    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });
}
void main().catch((e) => {
    console.error("[FATAL]", e);
    process.exit(1);
});
//# sourceMappingURL=server.js.map