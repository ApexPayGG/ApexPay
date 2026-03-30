import { z } from "zod";
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
export class PspDepositWebhookService {
    walletService;
    constructor(walletService) {
        this.walletService = walletService;
    }
    parseBody(body) {
        return payloadSchema.parse(body);
    }
    /**
     * Tylko `succeeded` księguje wpłatę. Idempotencja: `referenceId` = `psp_deposit:{paymentId}`.
     */
    async applyDeposit(payload) {
        if (payload.status !== "succeeded") {
            return { outcome: "ignored_status" };
        }
        const referenceId = `${PSP_DEPOSIT_REFERENCE_PREFIX}${payload.paymentId}`;
        const amount = BigInt(payload.amountMinor);
        const { transaction, created } = await this.walletService.depositFunds(payload.userId, amount, referenceId);
        return { outcome: "credited", transaction, duplicate: !created };
    }
}
//# sourceMappingURL=psp-deposit-webhook.service.js.map