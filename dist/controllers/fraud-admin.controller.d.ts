import type { Request, Response } from "express";
import { FraudDetectionService } from "../services/fraud-detection.service.js";
export declare class FraudAdminController {
    private readonly fraudDetectionService;
    constructor(fraudDetectionService: FraudDetectionService);
    list(req: Request, res: Response): Promise<void>;
    getById(req: Request, res: Response): Promise<void>;
    review(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=fraud-admin.controller.d.ts.map