import type { Transaction } from "@prisma/client";
import { z } from "zod";
import type { WalletService } from "./wallet.service.js";

export const PSP_DEPOSIT_REFERENCE_PREFIX = "psp_deposit:";

const payloadSchema = z
  .object({
    paymentId: z.string().trim().min(1).max(256),
    userId: z.string().trim().min(1).max(128),
    amountMinor: z
      .string()
      .regex(/^\d+$/)
      .refine((s) => BigInt(s) > 0n, { message: "amountMinor must be positive" }),
    status: z.enum(["succeeded", "failed", "pending", "canceled"]),
  })
  .strict();

export type PspDepositPayload = z.infer<typeof payloadSchema>;

export type PspDepositWebhookResult =
  | { outcome: "ignored_status" }
  | { outcome: "credited"; transaction: Transaction; duplicate: boolean };

export class PspDepositWebhookService {
  constructor(private readonly walletService: WalletService) {}

  parseBody(body: unknown): PspDepositPayload {
    return payloadSchema.parse(body);
  }

  /**
   * Tylko `succeeded` księguje wpłatę. Idempotencja: `referenceId` = `psp_deposit:{paymentId}`.
   */
  async applyDeposit(payload: PspDepositPayload): Promise<PspDepositWebhookResult> {
    if (payload.status !== "succeeded") {
      return { outcome: "ignored_status" };
    }

    const referenceId = `${PSP_DEPOSIT_REFERENCE_PREFIX}${payload.paymentId}`;
    const amount = BigInt(payload.amountMinor);
    const { transaction, created } = await this.walletService.depositFunds(
      payload.userId,
      amount,
      referenceId,
    );
    return { outcome: "credited", transaction, duplicate: !created };
  }
}
