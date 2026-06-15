import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { AutopayService } from "../services/autopay.service.js";
import { RideFinalizeService } from "../services/ride-finalize.service.js";
export declare class PaymentsController {
    private readonly autopayService;
    private readonly prisma;
    private readonly rideFinalizeService;
    private readonly redis;
    constructor(autopayService: AutopayService, prisma: PrismaClient, rideFinalizeService: RideFinalizeService, redis: Redis);
    initiate(req: Request, res: Response): Promise<void>;
    rideFinalize(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=payments.controller.d.ts.map