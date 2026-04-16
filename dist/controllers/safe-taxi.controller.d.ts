import type { Request, Response } from "express";
import { SafeTaxiService } from "../services/safe-taxi.service.js";
export declare class SafeTaxiController {
    private readonly service;
    constructor(service: SafeTaxiService);
    createRide(req: Request, res: Response): Promise<void>;
    /**
     * Rozliczenie: kierowca (JWT = driver) lub ADMIN. Prowizja platformy z env + SAFE_TAXI_PLATFORM_USER_ID.
     */
    settleRide(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=safe-taxi.controller.d.ts.map