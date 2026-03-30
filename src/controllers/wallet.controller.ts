import type { Request } from "express";
import type { Transaction } from "@prisma/client";
import type { WalletService } from "../services/wallet.service.js";
import { InsufficientFundsError } from "../services/wallet.service.js";

/** Tylko nieujemna liczba całkowita w zapisie dziesiętnym (bez ułamków). */
const UNSIGNED_INT_STRING = /^\d+$/;

export type ChargeEntryFeeRequest = Request<
  Record<string, never>,
  unknown,
  { amount?: unknown; referenceId?: unknown }
>;

export type ChargeEntryFeeResponse = {
  status: (code: number) => ChargeEntryFeeResponse;
  json: (body: unknown) => unknown;
};

export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  async deposit(
    req: ChargeEntryFeeRequest,
    res: ChargeEntryFeeResponse,
  ): Promise<void> {
    const userId = req.user?.id;
    if (userId === undefined || userId.trim().length === 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = req.body ?? {};
    const { amount, referenceId } = body;

    if (!this.isNonEmptyTrimmedString(referenceId) || typeof amount !== "string") {
      res.status(400).json({ error: "Bad Request" });
      return;
    }

    const amountStr = amount.trim();
    if (!UNSIGNED_INT_STRING.test(amountStr)) {
      res.status(400).json({ error: "Bad Request" });
      return;
    }

    try {
      const amountBigInt = BigInt(amountStr);
      const referenceIdStr = (referenceId as string).trim();
      const { transaction: txn } = await this.walletService.depositFunds(
        userId.trim(),
        amountBigInt,
        referenceIdStr,
      );
      res.status(200).json(this.transactionToJsonDto(txn));
    } catch (err) {
      if (err instanceof RangeError) {
        res.status(400).json({ error: "Bad Request", message: err.message });
        return;
      }
      res.status(500).json({ error: "Internal Server Error" });
    }
  }

  async chargeEntryFee(
    req: ChargeEntryFeeRequest,
    res: ChargeEntryFeeResponse,
  ): Promise<void> {
    try {
      const userId = req.user?.id;
      if (userId === undefined || userId.trim().length === 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const body = req.body ?? {};
      const { amount, referenceId } = body;

      if (!this.isNonEmptyTrimmedString(referenceId) || typeof amount !== "string") {
        res.status(400).json({ error: "Bad Request" });
        return;
      }

      const amountStr = amount.trim();
      if (!UNSIGNED_INT_STRING.test(amountStr)) {
        res.status(400).json({ error: "Bad Request" });
        return;
      }

      const amountBigInt = BigInt(amountStr);
      const referenceIdStr = (referenceId as string).trim();

      const txn = await this.walletService.processEntryFee(
        userId.trim(),
        amountBigInt,
        referenceIdStr,
      );

      res.status(200).json(this.transactionToJsonDto(txn));
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        res.status(402).json({ error: "Payment Required", message: err.message });
        return;
      }
      res.status(500).json({ error: "Internal Server Error" });
    }
  }

  private isNonEmptyTrimmedString(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value !== "string") return false;
    return value.trim().length > 0;
  }

  private transactionToJsonDto(txn: Transaction): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(txn as Record<string, unknown>)) {
      if (typeof val === "bigint") {
        out[key] = val.toString();
      } else {
        out[key] = val;
      }
    }
    return out;
  }
}
