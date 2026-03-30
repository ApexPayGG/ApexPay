import type { Request } from "express";
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
    deposit(req: ChargeEntryFeeRequest, res: ChargeEntryFeeResponse): Promise<void>;
    chargeEntryFee(req: ChargeEntryFeeRequest, res: ChargeEntryFeeResponse): Promise<void>;
    private isNonEmptyTrimmedString;
    private transactionToJsonDto;
}
//# sourceMappingURL=wallet.controller.d.ts.map