import type { Request, Response } from "express";
import type { IntegratorConfig } from "@prisma/client";
import { z, ZodError } from "zod";
import { IntegratorConfigService } from "../services/integrator-config.service.js";

const putBodySchema = z
  .object({
    webhookUrl: z.string().url().nullable(),
  })
  .strict();

function serializeConfig(row: IntegratorConfig) {
  return {
    id: row.id,
    userId: row.userId,
    webhookUrl: row.webhookUrl,
    webhookSecret: row.webhookSecret,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class IntegrationsConfigController {
  constructor(private readonly service: IntegratorConfigService) {}

  async get(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const row = await this.service.getConfig(userId);
      res.status(200).json({
        status: "success",
        data: row === null ? null : serializeConfig(row),
      });
    } catch (err) {
      console.error("[integrations/config GET]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  async put(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const body = putBodySchema.parse(req.body);
      const row = await this.service.upsertConfig(userId, body.webhookUrl);
      res.status(200).json({
        status: "success",
        data: serializeConfig(row),
      });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      console.error("[integrations/config PUT]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
