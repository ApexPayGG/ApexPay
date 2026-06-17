import type { Request, Response } from "express";
import { TradeService } from "../services/trade.service.js";
export declare class TradeController {
    private readonly tradeService;
    constructor(tradeService: TradeService);
    /** GET /api/v1/trades?seller=me — lista trade'ów zalogowanego sprzedawcy (wymaga JWT). */
    listMine(req: Request, res: Response): Promise<void>;
    create(req: Request, res: Response): Promise<void>;
    getById(req: Request, res: Response): Promise<void>;
    pay(req: Request, res: Response): Promise<void>;
    confirm(req: Request, res: Response): Promise<void>;
    cancel(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=trade.controller.d.ts.map