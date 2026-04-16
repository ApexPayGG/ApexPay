import type { Request, Response } from "express";
import { PayoutService } from "../services/payout.service.js";
import type { Redis } from "ioredis";
export declare class IntegrationsPayoutController {
    private readonly payoutService;
    private readonly redis;
    constructor(payoutService: PayoutService, redis: Redis);
    listPayouts(req: Request, res: Response): Promise<void>;
    create(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=integrations-payout.controller.d.ts.map