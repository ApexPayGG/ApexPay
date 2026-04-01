import type { Request, Response } from "express";
import type { WalletService } from "../services/wallet.service.js";
export declare class AdminController {
    private readonly walletService;
    constructor(walletService: WalletService);
    /** Lista transakcji (ledger) — paginacja `page` + `limit`. */
    listTransactions(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=admin.controller.d.ts.map