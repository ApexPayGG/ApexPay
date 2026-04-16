import type { Transaction } from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { WalletService } from "./wallet.service.js";

/** Prefiks klucza Redis: `idemp:deposit:{pspRefId}` */
export const PSP_DEPOSIT_IDEMP_KEY_PREFIX = "idemp:deposit:";

/** Prefiks wpisu ledger dla webhooka PSP (zgodny z wymaganiami integracji). */
export const PSP_DEPOSIT_LEDGER_REFERENCE_PREFIX = "dep:";

const payloadSchema = z
  .object({
    pspRefId: z.string().trim().min(1).max(256),
    amount: z.number().int().positive(),
    userId: z.string().trim().min(1).max(128),
    currency: z.string().trim().min(1).max(16),
    status: z.enum(["SUCCESS", "FAILED", "PENDING"]),
  })
  .strict();

export type PspDepositPayload = z.infer<typeof payloadSchema>;

export type PspDepositWebhookResult =
  | { outcome: "ignored_status" }
  | { outcome: "redis_duplicate" }
  | { outcome: "credited"; transaction: Transaction; duplicate: boolean };

const IDEMP_TTL_SEC = 86_400;

export class PspDepositWebhookService {
  constructor(
    private readonly walletService: WalletService,
    private readonly redis: Redis,
  ) {}

  parseBody(body: unknown): PspDepositPayload {
    return payloadSchema.parse(body);
  }

  /**
   * Tylko `SUCCESS` księguje wpłatę.
   * Idempotencja: Redis `SET … NX EX 86400` na `idemp:deposit:{pspRefId}`, potem ledger `dep:{pspRefId}`.
   */
  async applyDeposit(payload: PspDepositPayload): Promise<PspDepositWebhookResult> {
    if (payload.status !== "SUCCESS") {
      return { outcome: "ignored_status" };
    }

    const idempKey = `${PSP_DEPOSIT_IDEMP_KEY_PREFIX}${payload.pspRefId}`;
    const setOk = await this.redis.set(idempKey, "1", "EX", IDEMP_TTL_SEC, "NX");
    if (setOk !== "OK") {
      return { outcome: "redis_duplicate" };
    }

    const amount = BigInt(payload.amount);

    try {
      const { transaction, created } = await this.walletService.depositFundsPspWebhook(
        payload.userId,
        amount,
        payload.pspRefId,
      );
      return { outcome: "credited", transaction, duplicate: !created };
    } catch (err) {
      await this.redis.del(idempKey);
      throw err;
    }
  }
}
