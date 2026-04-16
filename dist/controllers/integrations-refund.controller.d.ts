import type { Request, Response } from "express";
import { RefundService } from "../services/refund.service.js";
import type { Redis } from "ioredis";
export declare class IntegrationsRefundController {
    private readonly refundService;
    private readonly redis;
    constructor(refundService: RefundService, redis: Redis);
    listForCharge(req: Request, res: Response): Promise<void>;
    create(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=integrations-refund.controller.d.ts.map