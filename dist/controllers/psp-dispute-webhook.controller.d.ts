import type { Request, Response } from "express";
import { DisputeService } from "../services/dispute.service.js";
export { PSP_DEPOSIT_SIGNATURE_HEADER, type GetPspDepositWebhookSecret, } from "../middleware/psp-deposit-hmac.middleware.js";
export declare class PspDisputeWebhookController {
    private readonly disputeService;
    constructor(disputeService: DisputeService);
    handle(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=psp-dispute-webhook.controller.d.ts.map