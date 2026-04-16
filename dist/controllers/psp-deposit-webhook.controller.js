import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { PspDepositWebhookService } from "../services/psp-deposit-webhook.service.js";
import { WalletNotFoundError } from "../services/wallet.service.js";
/** Re-export dla testów i integracji (HMAC w middleware). */
export { PSP_DEPOSIT_SIGNATURE_HEADER, } from "../middleware/psp-deposit-hmac.middleware.js";
export class PspDepositWebhookController {
    pspService;
    constructor(pspService) {
        this.pspService = pspService;
    }
    async handle(req, res) {
        try {
            const payload = this.pspService.parseBody(req.body);
            const result = await this.pspService.applyDeposit(payload);
            if (result.outcome === "ignored_status") {
                res.status(200).json({ acknowledged: true, credited: false });
                return;
            }
            if (result.outcome === "redis_duplicate") {
                res.status(200).json({
                    acknowledged: true,
                    credited: false,
                    duplicate: true,
                    reason: "redis_idempotent",
                });
                return;
            }
            res.status(200).json({
                acknowledged: true,
                credited: true,
                duplicate: result.duplicate,
                transactionId: result.transaction.id,
                referenceId: result.transaction.referenceId,
            });
        }
        catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({ error: "Bad Request" });
                return;
            }
            if (err instanceof WalletNotFoundError) {
                res.status(422).json({ error: "User or wallet not found" });
                return;
            }
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
                res.status(422).json({ error: "User or wallet not found" });
                return;
            }
            if (err instanceof RangeError) {
                res.status(400).json({ error: "Bad Request" });
                return;
            }
            throw err;
        }
    }
}
//# sourceMappingURL=psp-deposit-webhook.controller.js.map