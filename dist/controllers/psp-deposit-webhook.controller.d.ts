import type { Request, Response } from "express";
import { PspDepositWebhookService } from "../services/psp-deposit-webhook.service.js";
/** Re-export dla testów i integracji (HMAC w middleware). */
export { PSP_DEPOSIT_SIGNATURE_HEADER, type GetPspDepositWebhookSecret, } from "../middleware/psp-deposit-hmac.middleware.js";
export declare class PspDepositWebhookController {
    private readonly pspService;
    constructor(pspService: PspDepositWebhookService);
    handle(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=psp-deposit-webhook.controller.d.ts.map