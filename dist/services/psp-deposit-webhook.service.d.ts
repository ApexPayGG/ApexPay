import type { Transaction } from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { WalletService } from "./wallet.service.js";
/** Prefiks klucza Redis: `idemp:deposit:{pspRefId}` */
export declare const PSP_DEPOSIT_IDEMP_KEY_PREFIX = "idemp:deposit:";
/** Prefiks wpisu ledger dla webhooka PSP (zgodny z wymaganiami integracji). */
export declare const PSP_DEPOSIT_LEDGER_REFERENCE_PREFIX = "dep:";
declare const payloadSchema: z.ZodObject<{
    pspRefId: z.ZodString;
    amount: z.ZodNumber;
    userId: z.ZodString;
    currency: z.ZodString;
    status: z.ZodEnum<{
        PENDING: "PENDING";
        FAILED: "FAILED";
        SUCCESS: "SUCCESS";
    }>;
}, z.core.$strict>;
export type PspDepositPayload = z.infer<typeof payloadSchema>;
export type PspDepositWebhookResult = {
    outcome: "ignored_status";
} | {
    outcome: "redis_duplicate";
} | {
    outcome: "credited";
    transaction: Transaction;
    duplicate: boolean;
};
export declare class PspDepositWebhookService {
    private readonly walletService;
    private readonly redis;
    constructor(walletService: WalletService, redis: Redis);
    parseBody(body: unknown): PspDepositPayload;
    /**
     * Tylko `SUCCESS` księguje wpłatę.
     * Idempotencja: Redis `SET … NX EX 86400` na `idemp:deposit:{pspRefId}`, potem ledger `dep:{pspRefId}`.
     */
    applyDeposit(payload: PspDepositPayload): Promise<PspDepositWebhookResult>;
}
export {};
//# sourceMappingURL=psp-deposit-webhook.service.d.ts.map