import type { Request, Response } from "express";
import { IntegratorConfigService } from "../services/integrator-config.service.js";
export declare class IntegrationsConfigController {
    private readonly service;
    constructor(service: IntegratorConfigService);
    get(req: Request, res: Response): Promise<void>;
    put(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=integrations-config.controller.d.ts.map