import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import {
  DisputeChargeNotFoundError,
  DisputeService,
  DisputeValidationError,
} from "../services/dispute.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "../services/wallet.service.js";

export {
  PSP_DEPOSIT_SIGNATURE_HEADER,
  type GetPspDepositWebhookSecret,
} from "../middleware/psp-deposit-hmac.middleware.js";

export class PspDisputeWebhookController {
  constructor(private readonly disputeService: DisputeService) {}

  async handle(req: Request, res: Response): Promise<void> {
    try {
      const payload = this.disputeService.parsePspWebhookBody(req.body);
      const result = await this.disputeService.createFromWebhook(payload);

      if (result.duplicate) {
        res.status(200).json({
          acknowledged: true,
          duplicate: true,
          disputeId: result.dispute.id,
        });
        return;
      }

      res.status(200).json({
        acknowledged: true,
        duplicate: false,
        disputeId: result.dispute.id,
        webhookOutboxId: result.webhookOutboxId,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Bad Request" });
        return;
      }
      if (err instanceof DisputeChargeNotFoundError) {
        res.status(422).json({ error: "Charge not found" });
        return;
      }
      if (err instanceof DisputeValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof WalletNotFoundError) {
        res.status(422).json({ error: "Wallet not found" });
        return;
      }
      if (err instanceof InsufficientFundsError) {
        res.status(402).json({ error: "Insufficient funds" });
        return;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ error: "Conflict" });
        return;
      }
      throw err;
    }
  }
}
