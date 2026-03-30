import type { Request, Response } from "express";
import { MatchSettlementService } from "../services/match-settlement.service.js";
import type { WebSocketService } from "../services/websocket.service.js";
export declare class MatchResolveV1Controller {
    private readonly settlementService;
    private readonly wsService;
    constructor(settlementService: Pick<MatchSettlementService, "settleDisputedMatch">, wsService: WebSocketService);
    resolve(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=match-resolve-v1.controller.d.ts.map