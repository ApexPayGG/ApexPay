import type { Request, Response } from "express";
import { ConnectedAccountService } from "../services/connected-account.service.js";
export declare class IntegrationsAccountController {
    private readonly service;
    constructor(service: ConnectedAccountService);
    list(req: Request, res: Response): Promise<void>;
    create(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=integrations-account.controller.d.ts.map