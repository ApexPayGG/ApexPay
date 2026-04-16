import { randomBytes } from "node:crypto";
import type { IntegratorConfig, PrismaClient } from "@prisma/client";

export class IntegratorConfigService {
  constructor(private readonly prisma: PrismaClient) {}

  private generateWebhookSecret(): string {
    return randomBytes(32).toString("hex");
  }

  async getConfig(userId: string): Promise<IntegratorConfig | null> {
    return this.prisma.integratorConfig.findUnique({ where: { userId } });
  }

  /**
   * Pierwsze wywołanie tworzy rekord z nowym `webhookSecret`.
   * Kolejne aktualizują wyłącznie `webhookUrl` — sekret pozostaje bez zmian.
   */
  async upsertConfig(
    userId: string,
    webhookUrl: string | null,
  ): Promise<IntegratorConfig> {
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
