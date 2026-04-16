import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { ClearingService } from "../services/clearing.service.js";
import { TournamentBracketService } from "../services/tournament-bracket.service.js";
import type { WebSocketService } from "../services/websocket.service.js";
export declare class MatchController {
    private readonly prisma;
    private readonly clearingService;
    private readonly wsService;
    private readonly bracketService;
    constructor(prisma: PrismaClient, clearingService: ClearingService, wsService: WebSocketService, bracketService?: TournamentBracketService);
    reportResult(req: Request, res: Response): Promise<void>;
    resolveDispute(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=match.controller.d.ts.map