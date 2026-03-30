import type { Request, Response } from "express";
import { PspDepositWebhookService } from "../services/psp-deposit-webhook.service.js";
export declare const PSP_DEPOSIT_SIGNATURE_HEADER = "x-apexpay-signature";
export type GetPspDepositWebhookSecret = () => string | undefined;
export declare class PspDepositWebhookController {
    private readonly pspService;
    private readonly getSecret;
    constructor(pspService: PspDepositWebhookService, getSecret: GetPspDepositWebhookSecret);
    handle(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=psp-deposit-webhook.controller.d.ts.map