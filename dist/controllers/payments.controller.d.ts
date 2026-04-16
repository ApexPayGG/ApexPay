import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { AutopayService } from "../services/autopay.service.js";
export declare class PaymentsController {
    private readonly autopayService;
    private readonly prisma;
    constructor(autopayService: AutopayService, prisma: PrismaClient);
    initiate(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=payments.controller.d.ts.map