import type { IntegratorConfig, PrismaClient } from "@prisma/client";
export declare class IntegratorConfigService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    private generateWebhookSecret;
    getConfig(userId: string): Promise<IntegratorConfig | null>;
    /**
     * Pierwsze wywołanie tworzy rekord z nowym `webhookSecret`.
     * Kolejne aktualizują wyłącznie `webhookUrl` — sekret pozostaje bez zmian.
     */
    upsertConfig(userId: string, webhookUrl: string | null): Promise<IntegratorConfig>;
}
//# sourceMappingURL=integrator-config.service.d.ts.map