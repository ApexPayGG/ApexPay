import type { Transaction } from "@prisma/client";
import { z } from "zod";
import type { WalletService } from "./wallet.service.js";
export declare const PSP_DEPOSIT_REFERENCE_PREFIX = "psp_deposit:";
declare const payloadSchema: z.ZodObject<{
    paymentId: z.ZodString;
    userId: z.ZodString;
    amountMinor: z.ZodString;
    status: z.ZodEnum<{
        succeeded: "succeeded";
        failed: "failed";
        pending: "pending";
        canceled: "canceled";
    }>;
}, z.core.$strict>;
export type PspDepositPayload = z.infer<typeof payloadSchema>;
export type PspDepositWebhookResult = {
    outcome: "ignored_status";
} | {
    outcome: "credited";
    transaction: Transaction;
    duplicate: boolean;
};
export declare class PspDepositWebhookService {
    private readonly walletService;
    constructor(walletService: WalletService);
    parseBody(body: unknown): PspDepositPayload;
    /**
     * Tylko `succeeded` księguje wpłatę. Idempotencja: `referenceId` = `psp_deposit:{paymentId}`.
     */
    applyDeposit(payload: PspDepositPayload): Promise<PspDepositWebhookResult>;
}
export {};
//# sourceMappingURL=psp-deposit-webhook.service.d.ts.map