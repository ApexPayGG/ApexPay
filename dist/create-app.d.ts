import express from "express";
import type { Redis } from "ioredis";
import { type Server as HttpServer } from "http";
import type { PrismaClient } from "@prisma/client";
import { MatchSettlementService } from "./services/match-settlement.service.js";
import { WebSocketService } from "./services/websocket.service.js";
export type CreateAppOptions = {
    prisma: PrismaClient;
    redis: Redis;
    wsService?: WebSocketService;
    /** Override for tests; defaults to `new MatchSettlementService(prisma)`. */
    matchSettlementService?: Pick<MatchSettlementService, "settleDisputedMatch">;
    /**
     * Wywoływane po udanym commicie transakcji zapisującej WebhookOutbox (poza `$transaction`).
     * Np. publikacja `{ outboxId }` do RabbitMQ.
     */
    webhookPublish?: (outboxId: string) => Promise<void>;
};
export declare function createApp(options: CreateAppOptions): {
    app: ReturnType<typeof express>;
    httpServer: HttpServer;
    wsService: WebSocketService;
};
//# sourceMappingURL=create-app.d.ts.map