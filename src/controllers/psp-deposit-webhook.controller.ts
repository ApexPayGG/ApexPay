import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { PspDepositWebhookService } from "../services/psp-deposit-webhook.service.js";
import { verifyPspWebhookHmacSha256Hex } from "../services/psp-webhook-hmac.js";

export const PSP_DEPOSIT_SIGNATURE_HEADER = "x-apexpay-signature";

export type GetPspDepositWebhookSecret = () => string | undefined;

export class PspDepositWebhookController {
  constructor(
    private readonly pspService: PspDepositWebhookService,
    private readonly getSecret: GetPspDepositWebhookSecret,
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    const secret = this.getSecret();
    if (secret === undefined || secret.length === 0) {
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }

    const raw = req.rawBody;
    if (raw === undefined || raw.length === 0) {
      res.status(400).json({ error: "Bad Request" });
      return;
    }

    const sig = req.get(PSP_DEPOSIT_SIGNATURE_HEADER);
    if (!verifyPspWebhookHmacSha256Hex(raw, sig ?? undefined, secret)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const payload = this.pspService.parseBody(req.body);
      const result = await this.pspService.applyDeposit(payload);
      if (result.outcome === "ignored_status") {
        res.status(200).json({ acknowledged: true, credited: false });
        return;
      }
      res.status(200).json({
        acknowledged: true,
        credited: true,
        duplicate: result.duplicate,
        transactionId: result.transaction.id,
        referenceId: result.transaction.referenceId,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Bad Request" });
        return;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        res.status(422).json({ error: "User or wallet not found" });
        return;
      }
      throw err;
    }
  }
}
