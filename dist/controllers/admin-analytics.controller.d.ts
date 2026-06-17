import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
export declare class AdminAnalyticsController {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    overview(req: Request, res: Response): Promise<void>;
    revenueChart(req: Request, res: Response): Promise<void>;
    fraudChart(req: Request, res: Response): Promise<void>;
    static parseExportLimit(raw: unknown): number;
}
//# sourceMappingURL=admin-analytics.controller.d.ts.map