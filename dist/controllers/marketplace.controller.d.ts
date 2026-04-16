import type { Request, Response } from "express";
import { MarketplaceChargeService } from "../services/marketplace-charge.service.js";
export declare class MarketplaceController {
    private readonly service;
    constructor(service: MarketplaceChargeService);
    createConnectedAccount(req: Request, res: Response): Promise<void>;
    patchConnectedAccount(req: Request, res: Response): Promise<void>;
    createCharge(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=marketplace.controller.d.ts.map