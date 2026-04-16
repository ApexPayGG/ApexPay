import type { Request, Response } from "express";
import type { Redis } from "ioredis";
import { AutopayService } from "../services/autopay.service.js";
import { type PaymentMethodService } from "../services/payment-method.service.js";
import { type WalletService } from "../services/wallet.service.js";
export declare class AutopayItnWebhookController {
    private readonly autopayService;
    private readonly walletService;
    private readonly paymentMethodService;
    private readonly redis;
    constructor(autopayService: AutopayService, walletService: WalletService, paymentMethodService: PaymentMethodService, redis: Redis);
    handle(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=autopay-itn-webhook.controller.d.ts.map