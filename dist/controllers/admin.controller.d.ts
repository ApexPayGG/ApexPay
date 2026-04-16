import type { Request, Response } from "express";
import type { AuditLogService } from "../services/audit-log.service.js";
import { PayoutService } from "../services/payout.service.js";
import type { WalletService } from "../services/wallet.service.js";
export declare class AdminController {
    private readonly walletService;
    private readonly payoutService;
    private readonly auditLogService;
    constructor(walletService: WalletService, payoutService: PayoutService, auditLogService: AuditLogService);
    /** Dziennik audytu — filtry + kursor (createdAt desc). */
    listAuditLogs(req: Request, res: Response): Promise<void>;
    /** Lista transakcji (ledger) — paginacja `page` + `limit`. */
    listTransactions(req: Request, res: Response): Promise<void>;
    /** Rozliczenie wypłaty B2B (PAID / FAILED ze zwrotem na portfel subkonta). */
    settlePayout(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=admin.controller.d.ts.map