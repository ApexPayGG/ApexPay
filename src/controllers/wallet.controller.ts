import type { Request, Response } from "express";
import type { Transaction } from "@prisma/client";
import type { WalletService } from "../services/wallet.service.js";
import {
  InsufficientFundsError,
  TransferSelfError,
  WalletNotFoundError,
} from "../services/wallet.service.js";

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

  /** Odczyt własnego portfela (wymaga `authMiddleware`). */
  async getMyWallet(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const wallet = await this.walletService.getWalletForUser(userId);
      if (wallet === null) {
        res.status(404).json({ error: "Nie znaleziono portfela dla tego konta." });
        return;
      }

      res.status(200).json({
        walletId: wallet.id,
        balance: wallet.balance.toString(),
        updatedAt: wallet.updatedAt,
      });
    } catch (error) {
      console.error("Błąd pobierania portfela:", error);
      res.status(500).json({ error: "Wewnętrzny błąd systemu księgowego." });
    }
  }

  /**
   * Zasilenie portfela użytkownika (Bank centralny) — tylko rola ADMIN (`requireRole`).
   */
  /**
   * Przelew na inne konto użytkownika (P2P). Wymaga zalogowania.
   * Body: `toUserId`, `amount` (string cyfr), `referenceId` (unikalny klucz idempotencji).
   */
  async transfer(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const body = req.body as {
        toUserId?: unknown;
        amount?: unknown;
        referenceId?: unknown;
      };

      if (
        !this.isNonEmptyTrimmedString(body.toUserId) ||
        typeof body.amount !== "string" ||
        !UNSIGNED_INT_STRING.test(body.amount.trim()) ||
        !this.isNonEmptyTrimmedString(body.referenceId)
      ) {
        res.status(400).json({
          error:
            "Wymagane: toUserId, amount (liczba całkowita jako string), referenceId (unikalny).",
          code: "BAD_REQUEST",
        });
        return;
      }

      const toId = (body.toUserId as string).trim();
      const amountBigInt = BigInt(body.amount.trim());
      const ref = (body.referenceId as string).trim();

      const { idempotent } = await this.walletService.transferP2P(
        userId,
        toId,
        amountBigInt,
        ref,
      );

      res.status(200).json({
        message: idempotent
          ? "Transakcja już wcześniej zaksięgowana (idempotentność)."
          : "Przelew wykonany pomyślnie.",
        idempotent,
      });
    } catch (err) {
      if (err instanceof TransferSelfError) {
        res.status(400).json({ error: "Nie można przelać na to samo konto.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof WalletNotFoundError) {
        res.status(404).json({
          error: "Portfel nadawcy lub odbiorcy nie istnieje.",
          code: "NOT_FOUND",
        });
        return;
      }
      if (err instanceof InsufficientFundsError) {
        res.status(402).json({ error: "Niewystarczające środki.", code: "PAYMENT_REQUIRED" });
        return;
      }
      if (err instanceof RangeError) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      console.error("transfer P2P:", err);
      res.status(500).json({ error: "Błąd serwera przy przelewie.", code: "INTERNAL_ERROR" });
    }
  }

  async fundWallet(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as { targetUserId?: unknown; amount?: unknown };
      const { targetUserId, amount } = body;

      if (
        !this.isNonEmptyTrimmedString(targetUserId) ||
        typeof amount !== "string" ||
        !UNSIGNED_INT_STRING.test(amount.trim())
      ) {
        res.status(400).json({
          error:
            "Wymagane poprawne ID użytkownika oraz kwota większa od 0 (liczba całkowita w zapisie dziesiętnym).",
        });
        return;
      }

      const targetId = (targetUserId as string).trim();
      const amountBigInt = BigInt(amount.trim());

      const updated = await this.walletService.fundWalletAtomic(targetId, amountBigInt);
      res.status(200).json({
        message: "Konto zasilone pomyślnie.",
        newBalance: updated.balance.toString(),
      });
    } catch (err) {
      if (err instanceof WalletNotFoundError) {
        res.status(404).json({ error: "Portfel docelowy nie istnieje." });
        return;
      }
      if (err instanceof RangeError) {
        res.status(400).json({
          error:
            "Wymagane poprawne ID użytkownika oraz kwota większa od 0 (liczba całkowita w zapisie dziesiętnym).",
        });
        return;
      }
      console.error("Błąd zasilania portfela:", err);
      res.status(500).json({
        error: "Wewnętrzny błąd serwera podczas księgowania transakcji.",
      });
    }
  }

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
