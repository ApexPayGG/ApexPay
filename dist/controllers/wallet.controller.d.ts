import type { Request, Response } from "express";
import type { WalletService } from "../services/wallet.service.js";
export type ChargeEntryFeeRequest = Request<Record<string, never>, unknown, {
    amount?: unknown;
    referenceId?: unknown;
}>;
export type ChargeEntryFeeResponse = {
    status: (code: number) => ChargeEntryFeeResponse;
    json: (body: unknown) => unknown;
};
export declare class WalletController {
    private readonly walletService;
    constructor(walletService: WalletService);
    /** Odczyt własnego portfela (wymaga `authMiddleware`). */
    getMyWallet(req: Request, res: Response): Promise<void>;
    /**
     * Zasilenie portfela użytkownika (Bank centralny) — tylko rola ADMIN (`requireRole`).
     */
    /**
     * Przelew na inne konto użytkownika (P2P). Wymaga zalogowania.
     * Body: `toUserId`, `amount` (string cyfr), `referenceId` (unikalny klucz idempotencji).
     */
    transfer(req: Request, res: Response): Promise<void>;
    fundWallet(req: Request, res: Response): Promise<void>;
    deposit(req: ChargeEntryFeeRequest, res: ChargeEntryFeeResponse): Promise<void>;
    chargeEntryFee(req: ChargeEntryFeeRequest, res: ChargeEntryFeeResponse): Promise<void>;
    private isNonEmptyTrimmedString;
    private transactionToJsonDto;
}
//# sourceMappingURL=wallet.controller.d.ts.map