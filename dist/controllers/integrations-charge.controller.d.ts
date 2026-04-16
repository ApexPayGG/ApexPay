import type { Request, Response } from "express";
import { MarketplaceChargeService } from "../services/marketplace-charge.service.js";
import type { Redis } from "ioredis";
export declare class IntegrationsChargeController {
    private readonly marketplaceChargeService;
    private readonly redis;
    constructor(marketplaceChargeService: MarketplaceChargeService, redis: Redis);
    listCharges(req: Request, res: Response): Promise<void>;
    createCharge(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=integrations-charge.controller.d.ts.map