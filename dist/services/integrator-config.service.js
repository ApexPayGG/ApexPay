import { randomBytes } from "node:crypto";
export class IntegratorConfigService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    generateWebhookSecret() {
        return randomBytes(32).toString("hex");
    }
    async getConfig(userId) {
        return this.prisma.integratorConfig.findUnique({ where: { userId } });
    }
    /**
     * Pierwsze wywołanie tworzy rekord z nowym `webhookSecret`.
     * Kolejne aktualizują wyłącznie `webhookUrl` — sekret pozostaje bez zmian.
     */
    async upsertConfig(userId, webhookUrl) {
        const existing = await this.prisma.integratorConfig.findUnique({
            where: { userId },
        });
        if (existing === null) {
            return this.prisma.integratorConfig.create({
                data: {
                    userId,
                    webhookUrl,
                    webhookSecret: this.generateWebhookSecret(),
                },
            });
        }
        return this.prisma.integratorConfig.update({
            where: { userId },
            data: { webhookUrl },
        });
    }
}
//# sourceMappingURL=integrator-config.service.js.map