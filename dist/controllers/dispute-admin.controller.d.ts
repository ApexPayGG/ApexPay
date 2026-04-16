import type { Request, Response } from "express";
import { DisputeService } from "../services/dispute.service.js";
export declare class DisputeAdminController {
    private readonly disputeService;
    constructor(disputeService: DisputeService);
    list(req: Request, res: Response): Promise<void>;
    getById(req: Request, res: Response): Promise<void>;
    submitEvidence(req: Request, res: Response): Promise<void>;
    resolve(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=dispute-admin.controller.d.ts.map