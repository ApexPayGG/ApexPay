import type { Request, Response } from "express";
import type { WalletService } from "../services/wallet.service.js";

const MAX_LIMIT = 100;

export class AdminController {
  constructor(private readonly walletService: WalletService) {}

  /** Lista transakcji (ledger) — paginacja `page` + `limit`. */
  async listTransactions(req: Request, res: Response): Promise<void> {
    try {
      const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
      const pageRaw = Number.parseInt(String(req.query.page ?? "0"), 10);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
        : 50;
      const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? pageRaw : 0;
      const skip = page * limit;

      const { items, total } = await this.walletService.listTransactionsAdmin(skip, limit);
      res.status(200).json({
        items,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error("Admin listTransactions:", err);
      res.status(500).json({
        error: "Błąd serwera przy pobieraniu listy transakcji.",
        code: "INTERNAL_ERROR",
      });
    }
  }
}
