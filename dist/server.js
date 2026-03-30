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
import { register } from "./monitoring/metrics.js";
import { createMessageBroker, RabbitMqConnectionManager, } from "./services/message-broker.js";
import { OutboxCleanupService } from "./services/outbox-cleanup.service.js";
import { OutboxPollerService } from "./services/outbox-poller.service.js";
import { SettlementEventConsumerService } from "./services/settlement-event-consumer.service.js";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
}
const pool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const redis = new Redis(redisUrl);
const { app, httpServer } = createApp({ prisma, redis });
/** Liveness (K8s): proces HTTP działa — bez zapytań do DB/Redis. */
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});
/** Readiness (K8s): DB + Redis dostępne zanim Service poleje ruchem. */
app.get("/health/ready", async (_req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        const pong = await redis.ping();
        if (pong !== "PONG") {
            throw new Error("Redis ping unexpected");
        }
        res.status(200).json({ status: "ready" });
    }
    catch {
        res.status(503).json({ status: "not_ready" });
    }
});
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
const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
    console.log(`[ApexPay Core] Silnik gotowy na porcie ${PORT}`);
    console.log(`[ApexPay WS] Nasłuch WebSocket aktywny`);
});
async function shutdown(signal) {
    console.log(`[ApexPay] sygnał ${signal}, zamykanie…`);
    outboxPoller.stop();
    outboxCleanup.stop();
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
//# sourceMappingURL=server.js.map